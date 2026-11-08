"""Guard destructive finance resets while keeping the user's account."""
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


class ListCursor:
    def __init__(self, items=None):
        self.items = items or []

    async def to_list(self, _limit):
        return list(self.items)


def collection(*, count=0, items=None):
    return SimpleNamespace(
        count_documents=AsyncMock(return_value=count),
        find=lambda *_args, **_kwargs: ListCursor(items),
        delete_many=AsyncMock(),
        update_many=AsyncMock(),
        update_one=AsyncMock(),
    )


def financial_db(*, shared_items=None, owned_groups=None):
    names = [
        "people", "categories", "accounts", "account_adjustments",
        "transactions", "goals", "goal_events", "recurrences",
        "installments", "installment_purchases", "receivables",
        "notifications", "insight_dismissals", "insight_feedback",
        "insight_history", "files", "shared_expenses",
        "settlement_history", "settlement_payments", "groups",
        "import_rules", "idempotency_requests", "data_export_requests",
        "websocket_tickets", "auth_sessions", "password_reset_tokens",
        "password_reset_requests", "email_delivery_logs",
    ]
    values = {name: collection() for name in names}
    values["shared_expenses"] = collection(
        count=len(shared_items or []), items=shared_items
    )
    values["groups"] = collection(items=owned_groups)
    values["users"] = SimpleNamespace(
        find_one=AsyncMock(),
        update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1)),
        delete_one=AsyncMock(),
    )
    return SimpleNamespace(**values)


def user():
    return {
        "id": "user-1",
        "email": "person@example.com",
        "password_hash": server.hash_password("correct-password"),
        "status": "active",
        "role": "USER",
    }


def test_reset_blocks_unpaid_shared_settlements(monkeypatch):
    db = financial_db(shared_items=[{
        "id": "shared-1",
        "payer_id": "user-2",
        "participant_ids": ["user-1", "user-2"],
        "participants": [
            {"user_id": "user-1", "owed": 25, "paid_back": False},
            {"user_id": "user-2", "owed": 25, "paid_back": False},
        ],
    }])
    monkeypatch.setattr(server, "db", db)
    impact = asyncio.run(server.build_account_reset_impact(user()))
    assert impact["can_reset"] is False
    assert "pending_settlements" in impact["blockers"]


def test_reset_does_not_remove_groups_shared_with_others(monkeypatch):
    db = financial_db(owned_groups=[{
        "member_ids": ["user-1", "user-2"],
    }])
    monkeypatch.setattr(server, "db", db)
    impact = asyncio.run(server.build_account_reset_impact(user()))
    assert impact["can_reset"] is False
    assert impact["blockers"] == ["shared_groups"]


@pytest.mark.parametrize(
    ("password", "confirmation", "detail"),
    [
        ("wrong-password", "ZERAR", "Senha atual incorreta"),
        ("correct-password", "not-confirmed", "Digite ZERAR para confirmar"),
    ],
)
def test_reset_requires_password_and_exact_confirmation(
    monkeypatch, password, confirmation, detail,
):
    db = financial_db()
    db.users.find_one.return_value = user()
    monkeypatch.setattr(server, "db", db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.reset_own_account(
            server.AccountResetIn(password=password, confirmation=confirmation),
            user={"id": "user-1"},
        ))
    assert exc.value.status_code == 400
    assert exc.value.detail == detail
    db.transactions.delete_many.assert_not_awaited()
    db.users.update_one.assert_not_awaited()


def test_reset_preserves_account_and_session_but_clears_financial_data(monkeypatch):
    db = financial_db()
    db.users.find_one.return_value = user()
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "audit_event", AsyncMock())
    monkeypatch.setattr(server.ws_manager, "disconnect_user", AsyncMock())
    seed_defaults = AsyncMock()
    monkeypatch.setattr(server, "seed_user_defaults", seed_defaults)

    result = asyncio.run(server.reset_own_account(
        server.AccountResetIn(
            password="correct-password",
            confirmation="ZERAR",
        ),
        user={"id": "user-1"},
    ))

    assert result == {"ok": True}
    seed_defaults.assert_awaited_once_with("user-1", "EUR")
    db.users.delete_one.assert_not_awaited()
    db.auth_sessions.delete_many.assert_not_awaited()
    db.password_reset_tokens.delete_many.assert_not_awaited()
    db.transactions.delete_many.assert_awaited_once_with({"user_id": "user-1"})
    db.accounts.delete_many.assert_awaited_once_with({"user_id": "user-1"})
    db.import_rules.delete_many.assert_awaited_once_with({"user_id": "user-1"})
    db.idempotency_requests.delete_many.assert_awaited_once_with({"owner_id": "user-1"})
    db.data_export_requests.delete_many.assert_awaited_once_with({"user_id": "user-1"})
    db.groups.update_many.assert_awaited_once_with(
        {"member_ids": "user-1"},
        {"$pull": {"member_ids": "user-1", "admin_ids": "user-1"}},
    )
    calls = db.users.update_one.await_args_list
    assert calls[0].args[1]["$set"]["reset_in_progress"] is True
    assert set(calls[1].args[1]["$unset"]) == {
        "dashboard_widgets", "dashboard_widgets_version",
        "insight_prefs", "notif_prefs",
    }
    assert calls[-1].args[1] == {"$unset": {"reset_in_progress": ""}}


def test_legacy_reset_recreates_defaults_when_categories_and_accounts_empty(monkeypatch):
    db = financial_db()
    db.accounts.find_one = AsyncMock(return_value=None)
    db.categories.find = lambda *_args, **_kwargs: ListCursor()
    # The only scenario that should be repaired is a fully empty reset.
    monkeypatch.setattr(server, "db", db)
    seed_defaults = AsyncMock()
    monkeypatch.setattr(server, "seed_user_defaults", seed_defaults)

    result = asyncio.run(server.list_categories(user={"id": "user-1", "currency": "EUR"}))
    assert result == []
    seed_defaults.assert_awaited_once_with("user-1", "EUR")


def test_empty_categories_with_existing_wallet_are_not_overwritten(monkeypatch):
    db = financial_db()
    db.accounts.find_one = AsyncMock(return_value={"id": "wallet-1"})
    db.categories.find = lambda *_args, **_kwargs: ListCursor()
    monkeypatch.setattr(server, "db", db)
    seed_defaults = AsyncMock()
    monkeypatch.setattr(server, "seed_user_defaults", seed_defaults)

    result = asyncio.run(server.list_categories(user={"id": "user-1", "currency": "EUR"}))
    assert result == []
    seed_defaults.assert_not_awaited()
