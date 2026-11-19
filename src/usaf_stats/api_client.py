"""Minimal HTTP client for fencing-api (/v1 club endpoints).

usafencing-membership-stats never scrapes USA Fencing, FencingTracker, or AskFRED
directly. All fencing club data comes through this client.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import httpx


def _load_dotenv(repo_root: Path) -> dict[str, str]:
    env_path = repo_root / ".env"
    vals: dict[str, str] = {}
    if not env_path.exists():
        return vals
    for line in env_path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


class FencingApiClient:
    """Thin client for `fencing-api` `/v1/tracker/clubs` and `/v1/usfa/clubs`."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        repo_root: Path | None = None,
        timeout: float = 30.0,
    ) -> None:
        dotenv = _load_dotenv(repo_root) if repo_root else {}
        self.base_url = (
            base_url
            or os.environ.get("FENCING_API_URL")
            or dotenv.get("FENCING_API_URL")
            or "http://127.0.0.1:8780"
        ).rstrip("/")
        self.api_key = (
            api_key
            or os.environ.get("FENCING_API_KEY")
            or dotenv.get("FENCING_API_KEY")
            or ""
        )
        headers = {"Accept": "application/json", "User-Agent": "usafencing-membership-stats/0.1"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        self._client = httpx.Client(base_url=self.base_url, headers=headers, timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "FencingApiClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _get_with_optional_poll(self, path: str, live: bool = False) -> dict[str, Any]:
        params = {"live": "true"} if live else None
        resp = self._client.get(path, params=params)
        if resp.status_code == 202 and live:
            body = resp.json()
            job_id = body.get("job_id")
            if job_id:
                for _ in range(90):
                    time.sleep(3.0)
                    jr = self._client.get(f"/v1/jobs/{job_id}")
                    jr.raise_for_status()
                    jdata = jr.json()
                    if jdata.get("status") in ("done", "failed"):
                        break
            resp = self._client.get(path)
        resp.raise_for_status()
        return resp.json()

    def get_tracker_clubs(self, live: bool = False) -> dict[str, Any]:
        return self._get_with_optional_poll("/v1/tracker/clubs", live=live)

    def get_tracker_snapshots(self) -> dict[str, Any]:
        resp = self._client.get("/v1/tracker/clubs/snapshots")
        resp.raise_for_status()
        return resp.json()

    def get_usfa_clubs(self, live: bool = False) -> dict[str, Any]:
        return self._get_with_optional_poll("/v1/usfa/clubs", live=live)
