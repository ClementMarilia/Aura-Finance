import asyncio
import inspect
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import jwt
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.responses import Response

os.environ.setdefault("JWT_SECRET", "test-secret-for-security-hardening")
os.environ.setdefault(
    "MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10"
)
os.environ.setdefault("DB_NAME", "crelith_security_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_api_models_reject_mass_assignment_fields():
    with pytest.raises(ValidationError):
        server.UpdateProfileIn(name="User", role="SUPER_ADMIN")

    with pytest.raises(ValidationError):
        server.LoginIn(email="user@example.com", password="valid-password", user_id="other")


def test_access_token_is_short_lived_and_minimal():
    token = server.create_token("user-1", "user@example.com", 2, "session-1")
    payload = jwt.decode(
        token,
        server.JWT_SECRET,
        algorithms=[server.JWT_ALGORITHM],
        audience=server.JWT_AUDIENCE,
        issuer=server.JWT_ISSUER,
    )

    assert payload["type"] == "access"
    assert payload["sid"] == "session-1"
    assert 0 < payload["exp"] - payload["iat"] <= 15 * 60
    assert "password" not in payload
    assert "currency" not in payload


def test_revoked_session_rejects_an_otherwise_valid_access_token(monkeypatch):
    token = server.create_token("user-1", "user@example.com", 0, "session-1")
    users = SimpleNamespace(find_one=AsyncMock(return_value={
        "id": "user-1",
        "email": "user@example.com",
        "status": "active",
        "session_version": 0,
    }))
    sessions = SimpleNamespace(find_one=AsyncMock(return_value=None))
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users, auth_sessions=sessions))
    request = SimpleNamespace(headers={"Authorization": f"Bearer {token}"})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.get_current_user(request))

    assert exc.value.status_code == 401
    assert exc.value.detail == "Sessão invalidada"


@pytest.mark.parametrize(
    ("extension", "data", "expected"),
    [
        ("png", b"\x89PNG\r\n\x1a\nrest", "image/png"),
        ("pdf", b"%PDF-1.7 rest", "application/pdf"),
        ("jpg", b"\xff\xd8\xffrest", "image/jpeg"),
        ("png", b"<script>alert(1)</script>", None),
    ],
)
def test_upload_type_uses_real_file_signature(extension, data, expected):
    assert server.verified_upload_type(data, extension) == expected


def test_file_download_no_longer_accepts_token_in_query_string():
    parameters = inspect.signature(server.download_file).parameters
    assert "auth" not in parameters
    assert "user" in parameters


def test_refresh_cookie_is_httponly_secure_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("REFRESH_COOKIE_SAMESITE", "none")
    response = Response()

    server.set_refresh_cookie(response, "opaque-refresh-token")

    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "secure" in cookie
    assert "samesite=none" in cookie
    assert "path=/api/auth" in cookie


def test_safe_filename_removes_path_and_control_characters():
    assert server.safe_original_filename("../../secret\x00.pdf") == "secret_.pdf"


def test_audit_event_drops_secrets_and_financial_values(monkeypatch):
    audit_events = SimpleNamespace(insert_one=AsyncMock())
    monkeypatch.setattr(server, "db", SimpleNamespace(audit_events=audit_events))

    asyncio.run(server.audit_event(
        "test_event",
        changes={
            "new_password": "must-not-appear",
            "access_token": "must-not-appear",
            "amount": 999,
            "status": "confirmed",
        },
    ))

    document = audit_events.insert_one.await_args.args[0]
    assert document["changes"] == {"status": "confirmed"}
