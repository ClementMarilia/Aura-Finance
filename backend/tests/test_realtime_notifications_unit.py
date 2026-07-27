import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault(
    "MONGO_URL",
    "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10",
)
os.environ.setdefault("DB_NAME", "crelith_finance_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_ws_ticket_is_returned_once_but_only_its_hash_is_stored(monkeypatch):
    tickets = SimpleNamespace(
        delete_many=AsyncMock(),
        insert_one=AsyncMock(),
    )
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(websocket_tickets=tickets),
    )

    result = asyncio.run(server.create_ws_ticket(
        user={"id": "user-1", "session_version": 3},
    ))

    stored = tickets.insert_one.await_args.args[0]
    assert len(result["ticket"]) >= 32
    assert result["expires_in"] == server.WS_TICKET_TTL_SECONDS
    assert stored["ticket_hash"] == server.hash_ws_ticket(result["ticket"])
    assert result["ticket"] not in str(stored)
    assert stored["session_version"] == 3
    tickets.delete_many.assert_awaited_once_with({
        "user_id": "user-1",
        "used_at": None,
    })


def test_ws_ticket_is_consumed_atomically_and_cannot_be_reused(monkeypatch):
    raw_ticket = "secure-ticket-value-that-is-long-enough"
    ticket_doc = {
        "id": "ticket-1",
        "user_id": "user-1",
        "ticket_hash": server.hash_ws_ticket(raw_ticket),
        "session_version": 2,
        "used_at": None,
        "expires_at": datetime.now(timezone.utc) + timedelta(seconds=20),
    }
    tickets = SimpleNamespace(
        find_one=AsyncMock(side_effect=[ticket_doc, None]),
        update_one=AsyncMock(
            return_value=SimpleNamespace(modified_count=1),
        ),
    )
    users = SimpleNamespace(find_one=AsyncMock(return_value={
        "id": "user-1",
        "status": "active",
        "session_version": 2,
    }))
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(websocket_tickets=tickets, users=users),
    )

    user, status = asyncio.run(server.consume_ws_ticket(raw_ticket))
    reused_user, reused_status = asyncio.run(
        server.consume_ws_ticket(raw_ticket)
    )

    assert status == "ok"
    assert user["id"] == "user-1"
    assert reused_user is None
    assert reused_status == "invalid_ticket"
    assert tickets.update_one.await_count == 1


def test_ws_ticket_rejects_a_session_invalidated_after_issue(monkeypatch):
    raw_ticket = "secure-ticket-value-that-is-long-enough"
    ticket_doc = {
        "id": "ticket-1",
        "user_id": "user-1",
        "session_version": 1,
        "used_at": None,
        "expires_at": datetime.now(timezone.utc) + timedelta(seconds=20),
    }
    tickets = SimpleNamespace(
        find_one=AsyncMock(return_value=ticket_doc),
        update_one=AsyncMock(
            return_value=SimpleNamespace(modified_count=1),
        ),
    )
    users = SimpleNamespace(find_one=AsyncMock(return_value={
        "id": "user-1",
        "status": "active",
        "session_version": 2,
    }))
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(websocket_tickets=tickets, users=users),
    )

    user, status = asyncio.run(server.consume_ws_ticket(raw_ticket))

    assert user is None
    assert status == "invalid_session"


def test_websocket_runtime_dependency_is_installed():
    requirements = (
        Path(__file__).resolve().parents[1] / "requirements.txt"
    ).read_text()

    assert "uvicorn[standard]==" in requirements


def test_websocket_only_accepts_configured_origins(monkeypatch):
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "https://www.crelithtech.com,http://localhost:3000",
    )

    assert server.websocket_origin_allowed(
        "https://www.crelithtech.com/"
    )
    assert server.websocket_origin_allowed("http://localhost:3000")
    assert not server.websocket_origin_allowed("https://evil.example")
    assert not server.websocket_origin_allowed(None)


def test_frontend_never_places_a_credential_in_the_websocket_url():
    source = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "components"
        / "NotificationsBell.jsx"
    ).read_text()

    assert "/notifications/ws-ticket" in source
    assert "?token" not in source
    assert "new WebSocket(wsUrl)" in source
