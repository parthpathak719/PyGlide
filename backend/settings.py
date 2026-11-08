"""Environment configuration shared by the local and hosted backends."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"), override=False)


def hosted_mode() -> bool:
    return os.getenv("PYGLIDE_HOSTED", "false").lower() == "true"


def llm_provider() -> str:
    provider = os.getenv("LLM_PROVIDER", "ollama").strip().lower()
    if provider not in {"ollama", "groq"}:
        raise ValueError("LLM_PROVIDER must be ollama or groq.")
    return provider


def groq_model() -> str:
    return os.getenv("GROQ_MODEL", "openai/gpt-oss-20b").strip()
