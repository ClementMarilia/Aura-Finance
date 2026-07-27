import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault(
    "MONGO_URL",
    "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10",
)
os.environ.setdefault("DB_NAME", "crelith_finance_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_role_resolution_keeps_clement_marilia_as_only_super_admin():
    assert server.user_role({
        "email": "clementmarilia@gmail.com",
        "role": "USER",
    }) == "SUPER_ADMIN"
    assert server.user_role({
        "email": "other@example.com",
        "role": "ADMIN",
    }) == "ADMIN"
    assert server.user_role({
        "email": "user@example.com",
    }) == "USER"


def test_regular_admin_cannot_change_roles():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.require_super_admin({
            "id": "admin-1",
            "email": "admin@example.com",
            "role": "ADMIN",
        }))
    assert exc.value.status_code == 403


def test_super_admin_promotes_active_user(monkeypatch):
    candidate = {
        "id": "user-1",
        "name": "User",
        "email": "user@example.com",
        "role": "USER",
        "status": "active",
        "created_at": "2026-07-27T08:00:00+00:00",
    }
    users = SimpleNamespace(
        find_one=AsyncMock(return_value=dict(candidate)),
        update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1)),
    )
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))

    result = asyncio.run(server.update_admin_user_role(
        "user-1",
        server.AdminRoleUpdateIn(role="ADMIN"),
        super_admin={
            "id": "super-1",
            "email": "clementmarilia@gmail.com",
        },
    ))

    assert result["role"] == "ADMIN"
    update = users.update_one.await_args.args[1]["$set"]
    assert update["role"] == "ADMIN"
    assert update["role_updated_by"] == "super-1"


def test_super_admin_role_cannot_be_changed(monkeypatch):
    candidate = {
        "id": "super-1",
        "name": "Marilia",
        "email": "clementmarilia@gmail.com",
        "status": "active",
    }
    users = SimpleNamespace(find_one=AsyncMock(return_value=candidate))
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.update_admin_user_role(
            "super-1",
            server.AdminRoleUpdateIn(role="USER"),
            super_admin=candidate,
        ))
    assert exc.value.status_code == 409


def test_regular_admin_can_deactivate_user_and_disconnect_session(monkeypatch):
    candidate = {
        "id": "user-1",
        "name": "User",
        "email": "user@example.com",
        "role": "USER",
        "status": "active",
        "created_at": "2026-07-27T08:00:00+00:00",
    }
    users = SimpleNamespace(
        find_one=AsyncMock(return_value=dict(candidate)),
        update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1)),
    )
    manager = SimpleNamespace(disconnect_user=AsyncMock())
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))
    monkeypatch.setattr(server, "ws_manager", manager)

    result = asyncio.run(server.update_admin_user_status(
        "user-1",
        server.AdminStatusUpdateIn(status="inactive"),
        admin={
            "id": "admin-1",
            "email": "admin@example.com",
            "role": "ADMIN",
        },
    ))

    assert result["status"] == "inactive"
    manager.disconnect_user.assert_awaited_once_with("user-1", code=4003)


def test_regular_admin_cannot_deactivate_another_admin(monkeypatch):
    candidate = {
        "id": "admin-2",
        "name": "Admin 2",
        "email": "admin2@example.com",
        "role": "ADMIN",
        "status": "active",
    }
    users = SimpleNamespace(find_one=AsyncMock(return_value=candidate))
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.update_admin_user_status(
            "admin-2",
            server.AdminStatusUpdateIn(status="inactive"),
            admin={
                "id": "admin-1",
                "email": "admin1@example.com",
                "role": "ADMIN",
            },
        ))
    assert exc.value.status_code == 403


def test_inactive_user_cannot_authenticate():
    with pytest.raises(HTTPException) as exc:
        server.ensure_active_user({
            "id": "user-1",
            "status": "inactive",
        })
    assert exc.value.status_code == 403
    assert exc.value.detail == "Conta indisponível"
