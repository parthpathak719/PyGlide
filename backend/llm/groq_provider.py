"""Groq chat completions through httpx; no model weights or extra SDK needed."""

import json
import os

import httpx

from settings import groq_model

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


def request_options(prompt: str, model_name: str | None, stream: bool) -> dict:
    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        raise ValueError("Set GROQ_API_KEY on the backend to enable hosted AI feedback.")
    # Only the configured model can use this server's shared free quota.
    model = groq_model()
    if model_name and model_name != model:
        raise ValueError("The requested model is not enabled on this server.")
    system, _, user = prompt.removeprefix("[SYSTEM]\n").partition("\n[USER]\n")
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user[:14000]}],
        "stream": stream,
        "temperature": 0.4,
        "max_completion_tokens": 2048,
        "response_format": {"type": "json_object"},
    }
    if model.startswith("openai/gpt-oss-"):
        payload.update(reasoning_effort="low", include_reasoning=False)
    return {
        "headers": {"Authorization": f"Bearer {key}"},
        "json": payload,
        "timeout": 60.0,
    }


def call_groq(prompt: str, model_name: str | None = None) -> str:
    with httpx.Client() as client:
        response = client.post(GROQ_URL, **request_options(prompt, model_name, False))
        response.raise_for_status()
        return response.json()["choices"][0]["message"].get("content") or ""


def stream_groq(prompt: str, model_name: str | None = None):
    with httpx.stream("POST", GROQ_URL, **request_options(prompt, model_name, True)) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            event = json.loads(data)
            if event.get("error"):
                raise RuntimeError("Groq stopped the feedback stream.")
            choices = event.get("choices") or []
            if choices:
                content = choices[0].get("delta", {}).get("content")
                if content:
                    yield content


def failure_message(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        if exc.response.status_code == 429:
            return "Groq's free AI quota is temporarily exhausted. Try again later; basic RCA is still available."
        if exc.response.status_code in {401, 403}:
            return "Groq authentication failed. Check the backend's GROQ_API_KEY."
        return f"Groq AI is unavailable (HTTP {exc.response.status_code}). Basic RCA is still available."
    if isinstance(exc, ValueError):
        return str(exc)
    return "Groq AI is temporarily unavailable. Basic RCA is still available."
