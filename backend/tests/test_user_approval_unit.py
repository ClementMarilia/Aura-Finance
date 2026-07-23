import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault(
    "MONGO_URL",
    "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10",
)
os.environ.setdefault("DB_NAME", "crelith_finance_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class EmptyAsyncCursor:
    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration


def test_registration_creates_pending_identity_without_token_or_financial_defaults(monkeypatch):
    users = SimpleNamespace(
        find_one=AsyncMock(return_value=None),
        insert_one=AsyncMock(),
    )
    fake_db = SimpleNamespace(users=users)
    seed_defaults = AsyncMock()
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "seed_user_defaults", seed_defaults)

    result = asyncio.run(server.register(server.RegisterIn(
        name="Nova Pessoa",
        email="nova@example.com",
        password="secret123",
        currency="EUR",
    )))

    assert result == {
        "status": "pending",
        "email": "nova@example.com",
        "message": "Cadastro enviado para aprovação",
    }
    assert "token" not in result
    inserted = users.insert_one.await_args.args[0]
    assert inserted["status"] == "pending"
    assert inserted["password_hash"] != "secret123"
    seed_defaults.assert_not_awaited()


@pytest.mark.parametrize(
    ("status", "message"),
    [
        ("pending", "Cadastro aguardando aprovação da administradora"),
        ("rejected", "Cadastro não aprovado"),
    ],
)
def test_pending_and_rejected_users_cannot_login(monkeypatch, status, message):
    user = {
        "id": "candidate-1",
        "name": "Candidate",
        "email": "candidate@example.com",
        "password_hash": server.hash_password("secret123"),
        "status": status,
    }
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(users=SimpleNamespace(find_one=AsyncMock(return_value=user))),
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.login(server.LoginIn(
            email=user["email"],
            password="secret123",
        )))

    assert exc.value.status_code == 403
    assert message in exc.value.detail


def test_existing_user_remains_active_and_admin_is_resolved_by_email(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "clementmarilia@gmail.com")
    legacy_user = {
        "id": "marilia-1",
        "name": "Marilia",
        "email": "clementmarilia@gmail.com",
        "password_hash": server.hash_password("secret123"),
        "currency": "EUR",
        "created_at": "2026-07-23T10:00:00+00:00",
    }
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(users=SimpleNamespace(find_one=AsyncMock(return_value=legacy_user))),
    )

    result = asyncio.run(server.login(server.LoginIn(
        email=legacy_user["email"],
        password="secret123",
    )))

    assert result["token"]
    assert result["user"]["status"] == "active"
    assert result["user"]["is_admin"] is True


def test_non_admin_is_rejected():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.require_admin({
            "id": "user-1",
            "email": "not-admin@example.com",
        }))

    assert exc.value.status_code == 403


def test_approval_creates_defaults_then_activates_user(monkeypatch):
    candidate = {
        "id": "candidate-1",
        "name": "Candidate",
        "email": "candidate@example.com",
        "password_hash": "hidden",
        "currency": "BRL",
        "status": "pending",
        "created_at": "2026-07-23T10:00:00+00:00",
    }
    lock_result = SimpleNamespace(matched_count=1)
    activation_result = SimpleNamespace(matched_count=1)
    users = SimpleNamespace(
        find_one=AsyncMock(return_value=dict(candidate)),
        update_one=AsyncMock(side_effect=[lock_result, activation_result]),
    )
    categories = SimpleNamespace(
        find=lambda *args, **kwargs: EmptyAsyncCursor(),
        insert_one=AsyncMock(),
    )
    accounts = SimpleNamespace(
        find_one=AsyncMock(return_value=None),
        insert_one=AsyncMock(),
    )
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(users=users, categories=categories, accounts=accounts),
    )

    result = asyncio.run(server.approve_user(
        candidate["id"],
        admin={"id": "admin-1", "email": "clementmarilia@gmail.com"},
    ))

    assert result["status"] == "active"
    assert set(result) == {
        "id", "name", "email", "status", "created_at", "reviewed_at",
    }
    assert categories.insert_one.await_count == len(server.DEFAULT_CATEGORIES)
    accounts.insert_one.assert_awaited_once()
    assert users.update_one.await_count == 2
    update = users.update_one.await_args_list[1].args[1]
    assert update["$set"]["status"] == "active"
    assert update["$set"]["approved_by"] == "admin-1"


def test_admin_summary_never_exposes_password_or_financial_fields():
    result = server.admin_user_summary({
        "id": "user-1",
        "name": "Private User",
        "email": "private@example.com",
        "status": "pending",
        "created_at": "2026-07-23T10:00:00+00:00",
        "password_hash": "must-not-leak",
        "balance": 99999,
        "transactions": [{"amount": 100}],
    })

    assert set(result) == {
        "id", "name", "email", "status", "created_at", "reviewed_at",
    }
    assert "password_hash" not in result
    assert "balance" not in result
    assert "transactions" not in result
