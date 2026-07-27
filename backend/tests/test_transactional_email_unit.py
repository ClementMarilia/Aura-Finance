import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, HTTPException
from pydantic import ValidationError
from starlette.requests import Request

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault(
    "MONGO_URL",
    "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10",
)
os.environ.setdefault("DB_NAME", "crelith_finance_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def request_from(ip="203.0.113.8"):
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/api/auth/password-reset/request",
        "headers": [],
        "client": (ip, 1234),
    })


def test_registration_schedules_welcome_without_exposing_delivery_failure(monkeypatch):
    users = SimpleNamespace(
        find_one=AsyncMock(return_value=None),
        insert_one=AsyncMock(),
    )
    send_welcome = AsyncMock(return_value=False)
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))
    monkeypatch.setattr(
        server,
        "email_service",
        SimpleNamespace(send_welcome_email=send_welcome),
    )
    tasks = BackgroundTasks()

    result = asyncio.run(server.register(
        server.RegisterIn(
            name="Nova Pessoa",
            email="nova@example.com",
            password="secret123",
            privacy_acknowledged=True,
        ),
        tasks,
    ))

    assert result["status"] == "pending"
    assert len(tasks.tasks) == 1
    assert tasks.tasks[0].func is send_welcome


def test_password_reset_request_stores_only_hash_and_invalidates_previous(monkeypatch):
    user = {
        "id": "user-1",
        "email": "user@example.com",
        "language": "pt",
    }
    reset_requests = SimpleNamespace(
        count_documents=AsyncMock(return_value=0),
        insert_one=AsyncMock(),
    )
    reset_tokens = SimpleNamespace(
        update_many=AsyncMock(),
        insert_one=AsyncMock(),
    )
    users = SimpleNamespace(find_one=AsyncMock(return_value=user))
    raw_token = "raw-token-that-must-never-be-stored-" + ("x" * 32)
    monkeypatch.setattr(server.secrets, "token_urlsafe", lambda _size: raw_token)
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            users=users,
            password_reset_requests=reset_requests,
            password_reset_tokens=reset_tokens,
        ),
    )
    send_reset = AsyncMock()
    monkeypatch.setattr(
        server,
        "email_service",
        SimpleNamespace(
            public_settings=AsyncMock(return_value={"reset_expires_minutes": 30}),
            send_password_reset_email=send_reset,
        ),
    )
    tasks = BackgroundTasks()

    result = asyncio.run(server.request_password_reset(
        server.PasswordResetRequestIn(email=user["email"]),
        request_from(),
        tasks,
    ))

    assert result == {
        "ok": True,
        "message": server.PASSWORD_RESET_GENERIC_MESSAGE,
    }
    reset_tokens.update_many.assert_awaited_once()
    stored = reset_tokens.insert_one.await_args.args[0]
    assert stored["token_hash"] == server.hash_reset_token(raw_token)
    assert raw_token not in str(stored)
    assert len(tasks.tasks) == 1
    assert tasks.tasks[0].args[-1] == raw_token


def test_unknown_email_returns_same_response_without_creating_token(monkeypatch):
    reset_requests = SimpleNamespace(
        count_documents=AsyncMock(return_value=0),
        insert_one=AsyncMock(),
    )
    reset_tokens = SimpleNamespace(
        update_many=AsyncMock(),
        insert_one=AsyncMock(),
    )
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            users=SimpleNamespace(find_one=AsyncMock(return_value=None)),
            password_reset_requests=reset_requests,
            password_reset_tokens=reset_tokens,
        ),
    )
    tasks = BackgroundTasks()

    result = asyncio.run(server.request_password_reset(
        server.PasswordResetRequestIn(email="unknown@example.com"),
        request_from(),
        tasks,
    ))

    assert result["message"] == server.PASSWORD_RESET_GENERIC_MESSAGE
    reset_tokens.insert_one.assert_not_awaited()
    assert tasks.tasks == []


def test_password_reset_rate_limit_keeps_generic_response(monkeypatch):
    users = SimpleNamespace(find_one=AsyncMock())
    reset_requests = SimpleNamespace(
        count_documents=AsyncMock(return_value=server.PASSWORD_RESET_RATE_LIMIT),
    )
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            users=users,
            password_reset_requests=reset_requests,
        ),
    )

    result = asyncio.run(server.request_password_reset(
        server.PasswordResetRequestIn(email="user@example.com"),
        request_from(),
        BackgroundTasks(),
    ))

    assert result["message"] == server.PASSWORD_RESET_GENERIC_MESSAGE
    users.find_one.assert_not_awaited()


def test_password_reset_is_single_use_and_invalidates_sessions(monkeypatch):
    raw_token = "secure-reset-token-" + ("x" * 48)
    token_doc = {
        "id": "token-1",
        "user_id": "user-1",
        "token_hash": server.hash_reset_token(raw_token),
    }
    tokens = SimpleNamespace(
        find_one=AsyncMock(return_value=token_doc),
        update_one=AsyncMock(return_value=SimpleNamespace(modified_count=1)),
        update_many=AsyncMock(),
    )
    users = SimpleNamespace(
        find_one=AsyncMock(return_value={"id": "user-1"}),
        update_one=AsyncMock(),
    )
    ws_manager = SimpleNamespace(disconnect_user=AsyncMock())
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(password_reset_tokens=tokens, users=users),
    )
    monkeypatch.setattr(server, "ws_manager", ws_manager)

    result = asyncio.run(server.confirm_password_reset(server.PasswordResetIn(
        token=raw_token,
        new_password="new-secure-password",
    )))

    assert result == {"ok": True}
    claim = tokens.update_one.await_args.args[0]
    assert claim["token_hash"] == server.hash_reset_token(raw_token)
    assert raw_token not in str(claim)
    user_update = users.update_one.await_args.args[1]
    assert user_update["$inc"]["session_version"] == 1
    assert user_update["$set"]["password_hash"] != "new-secure-password"
    tokens.update_many.assert_awaited_once()
    ws_manager.disconnect_user.assert_awaited_once_with("user-1", code=4003)


def test_expired_or_used_reset_token_is_rejected(monkeypatch):
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            password_reset_tokens=SimpleNamespace(
                find_one=AsyncMock(return_value=None),
            ),
        ),
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.confirm_password_reset(server.PasswordResetIn(
            token="x" * 48,
            new_password="new-secure-password",
        )))

    assert exc.value.status_code == 400
    assert exc.value.detail == "Link inválido ou expirado"


def test_public_email_settings_never_returns_secret(monkeypatch):
    from email_service import EmailService

    monkeypatch.setenv("RESEND_API_KEY", "re_super_secret")
    database = SimpleNamespace(
        app_settings=SimpleNamespace(find_one=AsyncMock(return_value=None)),
    )

    result = asyncio.run(EmailService(database).public_settings())

    assert result["credential_configured"] is True
    assert "api_key" not in result
    assert "re_super_secret" not in str(result)


def test_admin_settings_reject_provider_credentials_in_payload():
    with pytest.raises(ValidationError):
        server.TransactionalEmailSettingsIn(
            enabled=True,
            welcome_enabled=True,
            password_reset_enabled=True,
            from_name="Crelith Finance",
            from_email="mail@example.com",
            reset_url="https://www.crelithtech.com/redefinir-senha",
            reset_expires_minutes=30,
            api_key="must-not-be-accepted",
        )


def test_reset_token_is_put_in_url_fragment_not_query(monkeypatch):
    from email_service import EmailService

    service = EmailService(SimpleNamespace())
    monkeypatch.setattr(service, "_settings", AsyncMock(return_value={
        "password_reset_enabled": True,
        "reset_url": "https://www.crelithtech.com/redefinir-senha",
        "reset_expires_minutes": 30,
    }))
    send = AsyncMock(return_value=True)
    monkeypatch.setattr(service, "_send", send)
    token = "secret-token-" + ("x" * 48)

    asyncio.run(service.send_password_reset_email({
        "id": "user-1",
        "email": "user@example.com",
        "language": "pt",
    }, token))

    html = send.await_args.args[3]
    assert f"#token={token}" in html
    assert f"?token={token}" not in html


def test_delivery_and_audit_failures_do_not_raise(monkeypatch):
    from email_service import EmailService

    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    database = SimpleNamespace(
        app_settings=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        email_delivery_logs=SimpleNamespace(
            insert_one=AsyncMock(side_effect=RuntimeError("database unavailable")),
        ),
    )

    sent = asyncio.run(EmailService(database).send_welcome_email({
        "id": "user-1",
        "name": "User",
        "email": "user@example.com",
        "language": "pt",
    }))

    assert sent is False
