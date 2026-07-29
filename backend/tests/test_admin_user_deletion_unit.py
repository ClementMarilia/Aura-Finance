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


class AsyncListCursor:
    def __init__(self, items=None):
        self.items = items or []

    async def to_list(self, _limit):
        return list(self.items)


def collection(count=0, shared_items=None):
    return SimpleNamespace(
        count_documents=AsyncMock(return_value=count),
        find=lambda *_args, **_kwargs: AsyncListCursor(shared_items),
        delete_many=AsyncMock(),
        update_many=AsyncMock(),
    )


def financial_db(**counts):
    return SimpleNamespace(
        transactions=collection(),
        accounts=collection(counts.get("wallets", 0)),
        account_adjustments=collection(counts.get("balance_adjustments", 0)),
        goals=collection(counts.get("goals", 0)),
        shared_expenses=collection(
            counts.get("shared_expenses", 0),
            counts.get("shared_items", []),
        ),
        recurrences=collection(counts.get("recurrences", 0)),
        installment_purchases=collection(
            counts.get("installment_purchases", 0),
        ),
        receivables=collection(counts.get("receivables", 0)),
        groups=collection(counts.get("groups_created", 0)),
    )


def test_financial_impact_counts_pending_settlements(monkeypatch):
    fake_db = financial_db(
        wallets=1,
        shared_expenses=1,
        shared_items=[{
            "payer_id": "user-1",
            "participants": [
                {"user_id": "user-1", "paid_back": False},
                {"user_id": "user-2", "paid_back": False},
            ],
        }],
    )
    fake_db.transactions.count_documents = AsyncMock(side_effect=[2, 3, 1])
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(server.user_financial_impact("user-1"))

    assert result["income"] == 2
    assert result["expenses"] == 3
    assert result["transfers"] == 1
    assert result["wallets"] == 1
    assert result["shared_expenses"] == 1
    assert result["pending_settlements"] == 1


def test_deletion_preview_blocks_self_and_financial_data(monkeypatch):
    fake_db = financial_db(goals=2)
    fake_db.users = collection()
    monkeypatch.setattr(server, "db", fake_db)
    candidate = {
        "id": "admin-1",
        "name": "Admin",
        "email": "admin@example.com",
        "status": "active",
        "created_at": "2026-07-27T08:00:00+00:00",
    }

    result = asyncio.run(server.build_user_deletion_impact(
        candidate,
        admin={
            "id": "admin-1",
            "email": "admin@example.com",
            "role": "ADMIN",
        },
    ))

    assert result["can_delete"] is False
    assert "self_delete" in result["blockers"]
    assert "goals" in result["blockers"]
    assert result["impact"]["goals"] == 2


def test_deletion_preview_blocks_last_active_admin(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com,owner@example.com")
    fake_db = financial_db()
    fake_db.users = collection(count=1)
    monkeypatch.setattr(server, "db", fake_db)
    candidate = {
        "id": "admin-2",
        "name": "Admin",
        "email": "admin@example.com",
        "status": "active",
        "created_at": "2026-07-27T08:00:00+00:00",
    }

    result = asyncio.run(server.build_user_deletion_impact(
        candidate,
        admin={
            "id": "admin-1",
            "email": "clementmarilia@gmail.com",
        },
    ))

    assert result["can_delete"] is False
    assert "last_active_admin" in result["blockers"]


def test_admin_deletion_blocks_user_with_financial_items(monkeypatch):
    candidate = {
        "id": "user-1",
        "name": "User",
        "email": "user@example.com",
        "status": "active",
        "created_at": "2026-07-27T08:00:00+00:00",
    }
    fake_db = financial_db(wallets=1)
    fake_db.users = SimpleNamespace(
        find_one=AsyncMock(return_value=candidate),
        update_one=AsyncMock(),
    )
    monkeypatch.setattr(server, "db", fake_db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.delete_admin_user(
            "user-1",
            admin={"id": "admin-1", "email": "clementmarilia@gmail.com"},
        ))

    assert exc.value.status_code == 409
    assert "wallets" in exc.value.detail["blockers"]
    fake_db.users.update_one.assert_not_awaited()


def test_admin_deletion_removes_only_housekeeping_and_identity(monkeypatch):
    candidate = {
        "id": "user-1",
        "name": "User",
        "email": "user@example.com",
        "status": "rejected",
        "created_at": "2026-07-27T08:00:00+00:00",
    }
    fake_db = financial_db()
    fake_db.users = SimpleNamespace(
        find_one=AsyncMock(return_value=candidate),
        update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1)),
        delete_one=AsyncMock(return_value=SimpleNamespace(deleted_count=1)),
    )
    fake_db.categories = collection()
    fake_db.notifications = collection()
    fake_db.insight_dismissals = collection()
    fake_db.insight_feedback = collection()
    fake_db.insight_history = collection()
    fake_db.files = collection()
    fake_db.websocket_tickets = collection()
    fake_db.settlement_history = collection()
    fake_db.password_reset_tokens = collection()
    fake_db.password_reset_requests = collection()
    fake_db.email_delivery_logs = collection()
    ws_manager = SimpleNamespace(disconnect_user=AsyncMock())
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "ws_manager", ws_manager)

    result = asyncio.run(server.delete_admin_user(
        "user-1",
        admin={"id": "admin-1", "email": "clementmarilia@gmail.com"},
    ))

    assert result == {"ok": True, "deleted_user_id": "user-1"}
    ws_manager.disconnect_user.assert_awaited_once_with("user-1", code=4001)
    fake_db.categories.delete_many.assert_awaited_once_with({"user_id": "user-1"})
    fake_db.accounts.delete_many.assert_awaited_once_with({"user_id": "user-1"})
    fake_db.notifications.delete_many.assert_awaited_once_with({"user_id": "user-1"})
    fake_db.insight_dismissals.delete_many.assert_awaited_once_with(
        {"user_id": "user-1"}
    )
    fake_db.insight_feedback.delete_many.assert_awaited_once_with(
        {"user_id": "user-1"}
    )
    fake_db.websocket_tickets.delete_many.assert_awaited_once_with(
        {"user_id": "user-1"}
    )
    fake_db.groups.update_many.assert_awaited_once()
    fake_db.users.delete_one.assert_awaited_once()


def test_deleted_user_token_is_rejected(monkeypatch):
    token = server.create_token("deleted-user", "deleted@example.com")
    users = SimpleNamespace(find_one=AsyncMock(return_value=None))
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))
    request = SimpleNamespace(headers={"Authorization": f"Bearer {token}"})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.get_current_user(request))

    assert exc.value.status_code == 401
    assert exc.value.detail == "Usuário não encontrado"


def test_deletion_lock_blocks_existing_sessions():
    with pytest.raises(HTTPException) as exc:
        server.ensure_active_user({
            "id": "user-1",
            "status": "active",
            "deletion_in_progress": True,
        })

    assert exc.value.status_code == 403
    assert exc.value.detail == "Conta em processo de exclusão"
