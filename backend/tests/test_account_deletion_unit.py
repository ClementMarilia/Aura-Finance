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


def collection(count=0, items=None):
    return SimpleNamespace(
        count_documents=AsyncMock(return_value=count),
        find=lambda *_args, **_kwargs: AsyncListCursor(items),
        delete_many=AsyncMock(),
        update_many=AsyncMock(),
        update_one=AsyncMock(),
    )


def account_deletion_db(shared_items=None, shared_count=0):
    return SimpleNamespace(
        transactions=collection(),
        accounts=collection(),
        goals=collection(),
        shared_expenses=collection(shared_count, shared_items),
        recurrences=collection(),
        installments=collection(),
        installment_purchases=collection(),
        receivables=collection(),
        groups=collection(),
        people=collection(),
        categories=collection(),
        notifications=collection(),
        files=collection(),
        websocket_tickets=collection(),
        settlement_history=collection(),
        password_reset_tokens=collection(),
        password_reset_requests=collection(),
        email_delivery_logs=collection(),
    )


def test_account_deletion_preview_blocks_pending_shared_settlement(monkeypatch):
    fake_db = account_deletion_db(
        shared_count=1,
        shared_items=[{
            "payer_id": "user-2",
            "participants": [
                {"user_id": "user-1", "owed": 10, "paid_back": False},
                {"user_id": "user-2", "owed": 10, "paid_back": False},
            ],
        }],
    )
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(server.build_account_deletion_impact({
        "id": "user-1",
        "email": "user@example.com",
        "role": "USER",
    }))

    assert result["can_delete"] is False
    assert result["blockers"] == ["pending_settlements"]
    assert result["impact"]["pending_settlements"] == 1


def test_account_deletion_preview_blocks_last_active_admin(monkeypatch):
    fake_db = account_deletion_db()
    fake_db.users = collection(count=1)
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(server.build_account_deletion_impact({
        "id": "admin-1",
        "email": "admin@example.com",
        "role": "ADMIN",
    }))

    assert result["can_delete"] is False
    assert result["blockers"] == ["last_active_admin"]


def test_account_deletion_requires_current_password(monkeypatch):
    candidate = {
        "id": "user-1",
        "email": "user@example.com",
        "role": "USER",
        "password_hash": server.hash_password("correct-password"),
    }
    fake_db = account_deletion_db()
    fake_db.users = SimpleNamespace(find_one=AsyncMock(return_value=candidate))
    monkeypatch.setattr(server, "db", fake_db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.delete_own_account(
            server.AccountDeletionIn(
                password="wrong-password",
                confirmation="user@example.com",
            ),
            user={"id": "user-1"},
        ))

    assert exc.value.status_code == 400
    assert exc.value.detail == "Senha atual incorreta"


def test_account_deletion_removes_personal_data_and_anonymizes_shared_history(
    monkeypatch,
):
    candidate = {
        "id": "user-1",
        "name": "User",
        "email": "user@example.com",
        "role": "USER",
        "status": "active",
        "password_hash": server.hash_password("correct-password"),
    }
    shared_expense = {
        "id": "shared-1",
        "creator_id": "user-1",
        "payer_id": "user-2",
        "participant_ids": ["user-1", "user-2"],
        "participants": [
            {"user_id": "user-1", "owed": 10, "paid_back": True},
            {"user_id": "user-2", "owed": 10, "paid_back": False},
        ],
        "status": "finalized",
    }
    fake_db = account_deletion_db(
        shared_count=1,
        shared_items=[shared_expense],
    )
    fake_db.users = SimpleNamespace(
        find_one=AsyncMock(return_value=candidate),
        update_one=AsyncMock(
            return_value=SimpleNamespace(matched_count=1),
        ),
        delete_one=AsyncMock(
            return_value=SimpleNamespace(deleted_count=1),
        ),
    )
    ws_manager = SimpleNamespace(disconnect_user=AsyncMock())
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "ws_manager", ws_manager)

    result = asyncio.run(server.delete_own_account(
        server.AccountDeletionIn(
            password="correct-password",
            confirmation="USER@example.com",
        ),
        user={"id": "user-1"},
    ))

    assert result == {"ok": True}
    ws_manager.disconnect_user.assert_awaited_once_with("user-1", code=4001)
    shared_update = fake_db.shared_expenses.update_one.await_args.args[1]["$set"]
    anonymous_id = shared_update["creator_id"]
    assert anonymous_id.startswith("deleted:")
    assert shared_update["participant_ids"] == [anonymous_id, "user-2"]
    assert shared_update["participants"][0]["user_id"] == anonymous_id
    fake_db.settlement_history.update_many.assert_any_await(
        {"debtor_id": "user-1"},
        {"$set": {"debtor_id": anonymous_id}},
    )
    fake_db.transactions.delete_many.assert_awaited_once_with(
        {"user_id": "user-1"}
    )
    fake_db.installments.delete_many.assert_awaited_once_with(
        {"user_id": "user-1"}
    )
    fake_db.groups.delete_many.assert_awaited_once_with(
        {"creator_id": "user-1"}
    )
    fake_db.websocket_tickets.delete_many.assert_awaited_once_with(
        {"user_id": "user-1"}
    )
    fake_db.users.delete_one.assert_awaited_once_with({
        "id": "user-1",
        "deletion_in_progress": True,
    })
