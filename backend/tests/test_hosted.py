"""Cloud provider, public API restrictions, and persistent deletion contracts."""

import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import httpx
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from llm import feedback_model
from llm import groq_provider
import example_deletions
import example_files
import main

ERROR = {"type": "ZeroDivisionError", "message": "division by zero", "line_number": 2}
RCA = {"summary": "The denominator is zero.", "suggested_fix": "Check the denominator."}


class GroqTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"LLM_PROVIDER": "groq", "GROQ_API_KEY": "fixture-key", "GROQ_MODEL": "openai/gpt-oss-20b"})
        env.start()
        self.addCleanup(env.stop)

    def test_request_separates_roles_and_caps_context_without_exposing_key(self):
        options = groq_provider.request_options("[SYSTEM]\nJSON instructions\n[USER]\n" + "x" * 20000, None, True)
        self.assertEqual(options["headers"]["Authorization"], "Bearer fixture-key")
        payload = options["json"]
        self.assertEqual(payload["messages"][0], {"role": "system", "content": "JSON instructions"})
        self.assertEqual(len(payload["messages"][1]["content"]), 14000)
        self.assertNotIn("fixture-key", json.dumps(payload))
        self.assertEqual(payload["response_format"], {"type": "json_object"})

    def test_unconfigured_models_cannot_spend_the_shared_quota(self):
        with self.assertRaisesRegex(ValueError, "not enabled"):
            groq_provider.request_options("prompt", "another-model", True)

    def test_missing_key_fails_before_contacting_groq(self):
        with patch.dict(os.environ, {"GROQ_API_KEY": ""}):
            with self.assertRaisesRegex(ValueError, "GROQ_API_KEY"):
                groq_provider.request_options("prompt", None, True)

    def test_sse_filters_reasoning_usage_and_end_events(self):
        events = [
            ': keepalive',
            'data: {"choices":[{"delta":{"reasoning":"hidden"}}]}',
            'data: {"choices":[{"delta":{"content":"{\\"headline\\": "}}]}',
            'data: {"choices":[{"delta":{"content":"\\"Fixed\\"}"}}]}',
            'data: {"choices":[],"usage":{"total_tokens":10}}',
            'data: [DONE]',
        ]
        response = Mock()
        response.iter_lines.return_value = iter(events)
        with patch.object(groq_provider.httpx, "stream") as stream:
            stream.return_value.__enter__.return_value = response
            self.assertEqual(''.join(groq_provider.stream_groq("prompt")), '{"headline": "Fixed"}')

    def test_stream_preserves_frontend_metadata_contract(self):
        with patch.object(feedback_model, "stream_groq", return_value=iter(['{"headline":', '"Check zero"}'])):
            output = ''.join(feedback_model.stream_developer_feedback_generator(ERROR, RCA))
        raw, metadata = output.split('[METADATA_SEPARATOR]')
        self.assertEqual(json.loads(raw)["headline"], "Check zero")
        parsed = json.loads(metadata)
        self.assertEqual(parsed["model_name"], "openai/gpt-oss-20b")
        self.assertEqual(parsed["mode"], "groq")
        self.assertTrue(parsed["fix_steps"])

    def test_quota_failure_returns_basic_rca_and_actionable_error(self):
        response = httpx.Response(429, request=httpx.Request("POST", groq_provider.GROQ_URL))
        failure = httpx.HTTPStatusError("quota", request=response.request, response=response)
        with patch.object(feedback_model, "stream_groq", side_effect=failure):
            output = ''.join(feedback_model.stream_developer_feedback_generator(ERROR, RCA))
        parsed = json.loads(output.split('[METADATA_SEPARATOR]')[1])
        self.assertIn("quota", parsed["provider_error"])
        self.assertEqual(parsed["root_cause"], RCA["summary"])
        self.assertEqual(parsed["mode"], "deterministic_fallback")

    def test_non_streaming_feedback_uses_groq(self):
        with patch.object(feedback_model, "call_groq", return_value='{"headline":"Cloud feedback"}') as call:
            result = feedback_model.generate_developer_feedback(ERROR, RCA)
        call.assert_called_once()
        self.assertEqual(result["headline"], "Cloud feedback")
        self.assertEqual(result["mode"], "groq")

    def test_local_stream_still_uses_selected_ollama_model(self):
        with patch.dict(os.environ, {"LLM_PROVIDER": "ollama"}), patch.object(feedback_model, "_stream_ollama", return_value=iter(['{"headline":"Local feedback"}'])) as stream:
            result = ''.join(feedback_model.stream_developer_feedback_generator(ERROR, RCA, model_name="llama3.2:1b"))
        self.assertEqual(stream.call_args.args[1], "llama3.2:1b")
        self.assertEqual(json.loads(result.split('[METADATA_SEPARATOR]')[1])["mode"], "ollama")


class HostedAPITests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"PYGLIDE_HOSTED": "true", "LLM_PROVIDER": "groq", "SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""})
        env.start()
        self.addCleanup(env.stop)
        main._ai_requests.clear()
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)

    def test_health_does_not_require_ai_or_database_connections(self):
        response = self.client.get('/health')
        self.assertEqual(response.json(), {"status": "ok", "hosted": True, "llm_provider": "groq"})

    def test_server_execution_and_dataset_access_are_disabled(self):
        with patch.object(main, "execute_code") as execute, patch.object(main, "ingest_bugsinpy_dataset") as ingest:
            for path in ['/execute', '/stop', '/ingest-bugsinpy']:
                self.assertEqual(self.client.post(path, json={}).status_code, 403)
        execute.assert_not_called()
        ingest.assert_not_called()

    def test_browser_traceback_analysis_still_works(self):
        response = self.client.post('/rca', json={"exception_type": "ZeroDivisionError", "message": "division by zero", "code": "print(1/0)", "traceback": "ZeroDivisionError: division by zero"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("rca", response.json())

    def test_oversized_requests_are_rejected(self):
        self.assertEqual(self.client.post('/log-debug', json={"log_text": "x" * (256 * 1024)}).status_code, 413)

    def test_shared_minute_limit_and_retry_header(self):
        with patch.object(main, "translate_text", return_value={"translated_text": "fixture"}):
            for _ in range(8):
                self.assertEqual(self.client.post('/translate-feedback', json={"text": "Hello", "target_language_code": "hi-IN"}).status_code, 200)
            response = self.client.post('/translate-feedback', json={"text": "Hello", "target_language_code": "hi-IN"})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers['retry-after'], '60')

    def test_cors_allows_only_configured_frontend(self):
        allowed = self.client.options('/rca', headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"})
        denied = self.client.options('/rca', headers={"Origin": "https://unrelated.example", "Access-Control-Request-Method": "POST"})
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(denied.status_code, 400)

    def test_hosted_deletion_records_persist_without_touching_bundled_files(self):
        name = "key_error.py"
        original = (example_files.EXAMPLES_DIR / name).read_bytes()
        tombstones = set()
        with patch.dict(os.environ, {"EXAMPLE_DELETE_PASSWORD": "fixture-password"}), patch.object(example_deletions, "configured", return_value=True), patch.object(example_deletions, "record_deletions", side_effect=lambda names, folder: tombstones.update(names)), patch.object(example_deletions, "deleted_names", side_effect=lambda: set(tombstones)):
            result = self.client.post('/workspace/examples/delete', json={"filenames": [name], "password": "fixture-password"})
            self.assertEqual(result.status_code, 200)
            # A new client represents a reload/restart; the external tombstone remains.
            with TestClient(main.app) as restarted:
                files = restarted.get('/workspace/examples').json()['files']
            self.assertNotIn(name, {file['name'] for file in files})
        self.assertEqual((example_files.EXAMPLES_DIR / name).read_bytes(), original)

    def test_hosted_deletion_without_storage_preserves_examples(self):
        with patch.dict(os.environ, {"EXAMPLE_DELETE_PASSWORD": "fixture-password"}):
            response = self.client.post('/workspace/examples/delete', json={"filenames": ["key_error.py"], "password": "fixture-password"})
        self.assertEqual(response.status_code, 503)
        self.assertTrue((example_files.EXAMPLES_DIR / 'key_error.py').is_file())

    def test_database_failure_does_not_resurrect_deleted_examples(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "https://fixture.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "fixture-secret"}), patch.object(example_deletions.httpx, "Client") as factory:
            factory.return_value.__enter__.return_value.request.side_effect = httpx.ConnectError("offline")
            response = self.client.get('/workspace/examples')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("fixture-secret", response.text)


if __name__ == '__main__':
    unittest.main()
