import os
from pathlib import Path
import sys
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
import sarvam_translate


class TranslationTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"SARVAM_API_KEY": "fixture-key", "PYGLIDE_HOSTED": "true", "LLM_PROVIDER": "groq"})
        self.env.start()
        self.addCleanup(self.env.stop)
        main._ai_requests.clear()

    def test_long_reports_translate_every_character_in_order(self):
        text = ("Paragraph one. " * 200) + "\n\n" + ("漢字 and more. " * 210) + "END_OF_REPORT"
        with patch.object(sarvam_translate.httpx, "Client") as factory:
            client = factory.return_value.__enter__.return_value
            client.post.side_effect = lambda *args, **kwargs: Mock(status_code=200, json=lambda: {
                "translated_text": kwargs["json"]["input"], "request_id": "fixture",
            })
            result = sarvam_translate.translate_text(text, "hi-IN")
        inputs = [call.kwargs["json"]["input"] for call in client.post.call_args_list]
        self.assertGreater(len(inputs), 1)
        self.assertTrue(all(0 < len(chunk) <= 2000 for chunk in inputs))
        self.assertEqual("".join(inputs), text)
        self.assertEqual(result["source_characters"], len(text))
        self.assertTrue(result["translated_text"].endswith("END_OF_REPORT"))

    def test_failed_later_chunk_does_not_return_an_incomplete_success(self):
        with patch.object(sarvam_translate.httpx, "Client") as factory:
            factory.return_value.__enter__.return_value.post.side_effect = [
                Mock(status_code=200, json=lambda: {"translated_text": "first part"}),
                Mock(status_code=429, text="Translation quota reached"),
            ]
            with self.assertRaisesRegex(RuntimeError, "quota"):
                sarvam_translate.translate_text("A" * 2500, "hi-IN")

    def test_empty_provider_output_is_an_error(self):
        with patch.object(sarvam_translate.httpx, "Client") as factory:
            factory.return_value.__enter__.return_value.post.return_value = Mock(status_code=200, json=lambda: {})
            with self.assertRaisesRegex(RuntimeError, "empty translation"):
                sarvam_translate.translate_text("Hello", "hi-IN")

    def test_oversized_reports_are_rejected_instead_of_truncated(self):
        with patch.object(sarvam_translate.httpx, "Client") as factory:
            with self.assertRaisesRegex(ValueError, "20,000"):
                sarvam_translate.translate_text("A" * 20001, "hi-IN")
            factory.assert_not_called()

    def test_waiting_for_translation_does_not_block_health_requests(self):
        entered, release = threading.Event(), threading.Event()
        def waiting_translator(*args):
            entered.set()
            release.wait(3)
            return {"translated_text": "fixture"}
        with patch.object(main, "ingest_mock_data"), patch.object(main, "translate_text", side_effect=waiting_translator):
            with TestClient(main.app) as client, ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(client.post, "/translate-feedback", json={"text": "Hello", "target_language_code": "hi-IN"})
                try:
                    self.assertTrue(entered.wait(2))
                    start = time.perf_counter()
                    self.assertEqual(client.get("/health").status_code, 200)
                    self.assertLess(time.perf_counter() - start, 1)
                finally:
                    release.set()
                self.assertEqual(future.result(timeout=3).status_code, 200)
