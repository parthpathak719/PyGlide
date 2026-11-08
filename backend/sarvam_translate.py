import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import dotenv_values


# Credentials belong in the environment or the ignored backend/.env file.

SARVAM_API_URL = "https://api.sarvam.ai/translate"
SARVAM_TRANSLATE_MODEL = "sarvam-translate:v1"
MAX_CHUNK_CHARACTERS = 2000
MAX_REPORT_CHARACTERS = 20000


def _chunks(text: str) -> list[str]:
    """Keep every character, preferring paragraph/sentence boundaries."""
    chunks = []
    while text:
        end = min(len(text), MAX_CHUNK_CHARACTERS)
        if end < len(text):
            start = MAX_CHUNK_CHARACTERS // 2
            for separator in ("\n\n", "\n", ". ", " "):
                boundary = text.rfind(separator, start, end)
                if boundary >= start:
                    end = boundary + len(separator)
                    break
        chunks.append(text[:end])
        text = text[end:]
    return chunks


def translate_text(text: str, target_language_code: str) -> dict[str, Any]:
    api_key = (
        os.getenv("SARVAM_API_KEY")
        or dotenv_values(Path(__file__).with_name(".env")).get("SARVAM_API_KEY")
        or ""
    ).strip()
    if not api_key:
        raise ValueError(
            "Sarvam API key is missing. Add it to backend/.env "
            "or set the SARVAM_API_KEY environment variable."
        )

    if not text.strip():
        raise ValueError("No text was provided for translation.")
    if len(text) > MAX_REPORT_CHARACTERS:
        raise ValueError(f"Translation accepts reports up to {MAX_REPORT_CHARACTERS:,} characters. Shorten the report and retry.")

    payload = {
        "source_language_code": "en-IN",
        "target_language_code": target_language_code,
        "mode": "formal",
        "model": SARVAM_TRANSLATE_MODEL,
        "enable_preprocessing": True,
        "numerals_format": "international",
    }

    headers = {
        "api-subscription-key": api_key,
        "Content-Type": "application/json",
    }

    translations = []
    request_ids = []
    with httpx.Client(timeout=30) as client:
        for chunk in _chunks(text):
            response = client.post(SARVAM_API_URL, json={**payload, "input": chunk}, headers=headers)
            if response.status_code >= 400:
                raise RuntimeError(f"Sarvam translation failed: {response.text}")
            data = response.json()
            translated = data.get("translated_text", "")
            if not isinstance(translated, str) or not translated.strip():
                raise RuntimeError("Sarvam returned an empty translation. Please retry.")
            translations.append(translated)
            if data.get("request_id"):
                request_ids.append(data["request_id"])
    return {
        "translated_text": "\n".join(translations),
        "source_language_code": "en-IN",
        "target_language_code": target_language_code,
        "request_id": request_ids[-1] if request_ids else None,
        "request_ids": request_ids,
        "chunk_count": len(translations),
        "source_characters": len(text),
    }
