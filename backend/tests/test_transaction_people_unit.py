import asyncio
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aura_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
server = importlib.import_module("server")


def test_private_person_must_belong_to_transaction_owner(monkeypatch):
    fake_db = SimpleNamespace(
        people=SimpleNamespace(find_one=AsyncMock(return_value={
            "id": "mother",
            "owner_user_id": "marilia",
            "name": "Minha mãe",
        })),
        shared_expenses=SimpleNamespace(find_one=AsyncMock()),
        users=SimpleNamespace(find_one=AsyncMock()),
    )
    monkeypatch.setattr(server, "db", fake_db)

    person = asyncio.run(
        server.validate_transaction_person(
            "mother",
            {"id": "marilia", "language": "pt"},
        )
    )

    assert person["id"] == "mother"
    assert person["external"] is True
    fake_db.shared_expenses.find_one.assert_not_awaited()


def test_unknown_or_foreign_person_is_rejected(monkeypatch):
    fake_db = SimpleNamespace(
        people=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        shared_expenses=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        users=SimpleNamespace(find_one=AsyncMock()),
    )
    monkeypatch.setattr(server, "db", fake_db)

    with pytest.raises(server.HTTPException) as error:
        asyncio.run(
            server.validate_transaction_person(
                "foreign-person",
                {"id": "marilia", "language": "pt"},
            )
        )

    assert error.value.status_code == 404
    fake_db.users.find_one.assert_not_awaited()


def test_related_registered_user_can_be_selected(monkeypatch):
    fake_db = SimpleNamespace(
        people=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        shared_expenses=SimpleNamespace(find_one=AsyncMock(return_value={
            "id": "shared-1",
            "creator_id": "marilia",
            "participant_ids": ["marilia", "wife"],
        })),
        users=SimpleNamespace(find_one=AsyncMock(return_value={
            "id": "wife",
            "name": "Minha esposa",
            "email": "wife@example.test",
        })),
    )
    monkeypatch.setattr(server, "db", fake_db)

    person = asyncio.run(
        server.validate_transaction_person(
            "wife",
            {"id": "marilia", "language": "pt"},
        )
    )

    assert person["id"] == "wife"
    assert person["name"] == "Minha esposa"
    assert person.get("external") is not True


def test_transfer_cannot_have_a_person():
    payload = server.TransactionIn(
        type="transfer",
        date="2026-07-28",
        amount=10,
        person_id="mother",
        from_account_id="wallet-a",
        to_account_id="wallet-b",
    )

    with pytest.raises(server.HTTPException) as error:
        asyncio.run(server._validate_transfer(payload, {"id": "marilia"}))

    assert error.value.status_code == 400
    assert "não possuem pessoa" in error.value.detail


class Cursor:
    def __init__(self, items):
        self.items = items

    async def to_list(self, _limit):
        return self.items


def test_recurrence_copies_person_to_generated_transaction(monkeypatch):
    recurrence = {
        "id": "rec-1",
        "user_id": "marilia",
        "type": "income",
        "amount": 25,
        "category_id": None,
        "person_id": "mother",
        "account_id": "wallet-1",
        "payment_method": None,
        "description": "Pagamento",
        "frequency": "monthly",
        "next_run": "2026-07-01",
        "active": True,
    }
    transactions = SimpleNamespace(
        find_one=AsyncMock(return_value=None),
        insert_one=AsyncMock(),
    )
    fake_db = SimpleNamespace(
        recurrences=SimpleNamespace(
            find=lambda *_args, **_kwargs: Cursor([recurrence]),
            update_one=AsyncMock(),
        ),
        transactions=transactions,
    )
    monkeypatch.setattr(server, "db", fake_db)

    asyncio.run(
        server.materialize_recurrences(
            "marilia",
            server.date(2026, 7, 31),
        )
    )

    inserted = transactions.insert_one.await_args.args[0]
    assert inserted["person_id"] == "mother"
    assert inserted["recurrence_id"] == "rec-1"


def test_private_person_summary_keeps_optional_email():
    person = server.private_person_summary({
        "id": "friend-1",
        "name": "Amigo 1",
        "email": "friend@example.test",
    })

    assert person["email"] == "friend@example.test"
    assert person["external"] is True


def test_pending_receivable_notifies_matching_active_user_once(monkeypatch):
    people = SimpleNamespace(find_one=AsyncMock(return_value={
        "id": "friend-1",
        "owner_user_id": "marilia",
        "name": "Amigo 1",
        "email": "friend@example.test",
    }))
    users = SimpleNamespace(find_one=AsyncMock(return_value={
        "id": "friend-user",
        "name": "Amigo 1",
        "email": "friend@example.test",
        "status": "active",
    }))
    transactions = SimpleNamespace(update_one=AsyncMock())
    notify = AsyncMock()
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            people=people,
            users=users,
            transactions=transactions,
        ),
    )
    monkeypatch.setattr(server, "push_notification", notify)
    transaction = {
        "id": "tx-1",
        "type": "income",
        "status": "pending",
        "person_id": "friend-1",
        "amount": 50,
        "currency": "BRL",
        "description": "Empréstimo",
    }

    asyncio.run(server.notify_pending_receivable_counterparty(
        transaction,
        {"id": "marilia", "name": "Marilia", "currency": "EUR"},
    ))
    asyncio.run(server.notify_pending_receivable_counterparty(
        transaction,
        {"id": "marilia", "name": "Marilia", "currency": "EUR"},
    ))

    notify.assert_awaited_once()
    args = notify.await_args.args
    assert args[0] == "friend-user"
    assert "R$ 50.00" in args[3]
    assert args[5]["currency"] == "BRL"
    transactions.update_one.assert_awaited_once()


def test_person_without_email_never_performs_account_lookup(monkeypatch):
    users = SimpleNamespace(find_one=AsyncMock())
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            people=SimpleNamespace(find_one=AsyncMock(return_value={
                "id": "friend-2",
                "owner_user_id": "marilia",
                "name": "Amigo 2",
                "email": None,
            })),
            users=users,
            transactions=SimpleNamespace(update_one=AsyncMock()),
        ),
    )
    notify = AsyncMock()
    monkeypatch.setattr(server, "push_notification", notify)

    asyncio.run(server.notify_pending_receivable_counterparty(
        {
            "id": "tx-2",
            "type": "income",
            "status": "pending",
            "person_id": "friend-2",
            "amount": 100,
            "currency": "BRL",
        },
        {"id": "marilia", "name": "Marilia", "currency": "EUR"},
    ))

    users.find_one.assert_not_awaited()
    notify.assert_not_awaited()
