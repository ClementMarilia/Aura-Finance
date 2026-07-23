import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault(
    "MONGO_URL",
    "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10",
)
os.environ.setdefault("DB_NAME", "aura_finance_test")
os.environ["CORS_ORIGINS"] = (
    "https://www.crelithtech.com,"
    "https://aura-finance-inky.vercel.app"
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def test_health_check_returns_ok_when_mongodb_is_available(monkeypatch):
    fake_db = AsyncMock()
    fake_db.command.return_value = {"ok": 1}
    monkeypatch.setattr(server, "db", fake_db)

    assert asyncio.run(server.health_check()) == {"status": "ok"}


def test_health_check_returns_503_when_mongodb_is_unavailable(monkeypatch):
    fake_db = AsyncMock()
    fake_db.command.side_effect = RuntimeError("database unavailable")
    monkeypatch.setattr(server, "db", fake_db)

    try:
        asyncio.run(server.health_check())
    except HTTPException as exc:
        assert exc.status_code == 503
    else:
        raise AssertionError("health check should fail closed")


def test_cors_allows_production_and_blocks_unknown_origins():
    client = TestClient(server.app)
    headers = {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }

    allowed = client.options(
        "/api/auth/login",
        headers={"Origin": "https://www.crelithtech.com", **headers},
    )
    blocked = client.options(
        "/api/auth/login",
        headers={"Origin": "https://evil.example", **headers},
    )

    assert allowed.status_code == 200
    assert (
        allowed.headers["access-control-allow-origin"]
        == "https://www.crelithtech.com"
    )
    assert blocked.status_code == 400
    assert "access-control-allow-origin" not in blocked.headers
