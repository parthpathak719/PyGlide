"""Persist hosted example tombstones without changing Render's temporary disk."""

import os

import httpx
from fastapi import HTTPException

FOLDER_MARKER = "__examples_folder__"


def configured() -> bool:
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"))


def _request(method: str, **kwargs):
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise HTTPException(503, "Shared example deletion requires Supabase. Configure it using DEPLOYMENT.md.")
    try:
        with httpx.Client(timeout=15) as client:
            response = client.request(
                method, f"{url}/rest/v1/pyglide_example_deletions",
                headers={"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "resolution=ignore-duplicates,return=minimal"},
                **kwargs,
            )
            response.raise_for_status()
            return response
    except httpx.HTTPError as exc:
        # Never expose credential-bearing request headers or database errors.
        raise HTTPException(503, "Example storage is unavailable. Check Supabase and retry.") from exc


def deleted_names() -> set[str]:
    if not configured():
        return set()
    response = _request("GET", params={"select": "name", "limit": "1000"})
    return {row["name"] for row in response.json()}


def record_deletions(names: set[str], folder: bool):
    targets = names | ({FOLDER_MARKER} if folder else set())
    if not targets:
        return
    _request("POST", json=[{"name": name} for name in sorted(targets)])
