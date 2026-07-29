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


class AsyncListCursor:
    def __init__(self, items=None):
        self.items = items or []

    async def to_list(self, _limit):
        return list(self.items)


def test_balance_breakdown_explains_every_source_without_mixing_income():
    result = server.account_balance_breakdown(
        {
            "id": "wallet-1",
            "name": "Revolut",
            "currency": "EUR",
            "initial_balance": 100,
            "created_at": "2026-01-01T00:00:00+00:00",
        },
        [
            {
                "id": "income-1",
                "type": "income",
                "account_id": "wallet-1",
                "amount": 50,
                "date": "2026-07-01",
                "description": "Salário",
            },
            {
                "id": "expense-1",
                "type": "expense",
                "account_id": "wallet-1",
                "amount": 20,
                "date": "2026-07-02",
                "description": "Mercado",
            },
            {
                "id": "transfer-in",
                "type": "transfer",
                "to_account_id": "wallet-1",
                "amount": 12,
                "target_amount": 10,
                "date": "2026-07-03",
            },
            {
                "id": "transfer-out",
                "type": "transfer",
                "from_account_id": "wallet-1",
                "amount": 30,
                "target_amount": 32,
                "date": "2026-07-04",
            },
        ],
        [{
            "id": "installment-1",
            "amount": 15,
            "due_date": "2026-07-05",
            "description": "Notebook (2/10)",
        }],
        [{
            "id": "adjustment-1",
            "amount": -5,
            "date": "2026-07-06",
            "note": "Conferência bancária",
        }],
    )

    assert result["components"] == {
        "initial_balance": 100.0,
        "income": 50.0,
        "expense": 20.0,
        "transfers_in": 10.0,
        "transfers_out": 30.0,
        "installments": 15.0,
        "adjustments": -5.0,
    }
    assert result["current_balance"] == 90.0
    assert len(result["entries"]) == 7
    assert next(
        item for item in result["entries"] if item["kind"] == "adjustment"
    )["amount"] == -5


def reconciliation_db(*, transactions=None, adjustments=None):
    account_adjustments = SimpleNamespace(
        find=lambda *_args, **_kwargs: AsyncListCursor(adjustments),
        insert_one=AsyncMock(),
    )
    return SimpleNamespace(
        accounts=SimpleNamespace(
            find_one=AsyncMock(return_value={
                "id": "wallet-1",
                "user_id": "user-1",
                "name": "Revolut",
                "currency": "EUR",
                "initial_balance": 100,
            }),
        ),
        transactions=SimpleNamespace(
            find=lambda *_args, **_kwargs: AsyncListCursor(transactions),
        ),
        installments=SimpleNamespace(
            find=lambda *_args, **_kwargs: AsyncListCursor([]),
        ),
        installment_purchases=SimpleNamespace(
            find=lambda *_args, **_kwargs: AsyncListCursor([]),
        ),
        account_adjustments=account_adjustments,
    )


def test_reconciliation_creates_a_separate_auditable_adjustment(monkeypatch):
    fake_db = reconciliation_db(
        transactions=[{
            "id": "expense-1",
            "type": "expense",
            "status": "paid",
            "account_id": "wallet-1",
            "amount": 76.60,
            "date": "2026-07-29",
        }],
    )
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(server.reconcile_account_balance(
        "wallet-1",
        server.AccountReconciliationIn(
            actual_balance=0,
            expected_balance=23.40,
            note="  Conferido   no extrato  ",
        ),
        user={"id": "user-1", "currency": "EUR"},
        idempotency_key=None,
    ))

    assert result["adjusted"] is True
    assert result["difference"] == -23.40
    assert result["current_balance"] == 0
    inserted = fake_db.account_adjustments.insert_one.await_args.args[0]
    assert inserted["amount"] == -23.40
    assert inserted["previous_balance"] == 23.40
    assert inserted["actual_balance"] == 0
    assert inserted["currency"] == "EUR"
    assert inserted["note"] == "Conferido no extrato"


def test_reconciliation_rejects_a_stale_calculated_balance(monkeypatch):
    fake_db = reconciliation_db()
    monkeypatch.setattr(server, "db", fake_db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.reconcile_account_balance(
            "wallet-1",
            server.AccountReconciliationIn(
                actual_balance=0,
                expected_balance=90,
            ),
            user={"id": "user-1", "currency": "EUR"},
            idempotency_key=None,
        ))

    assert exc.value.status_code == 409
    fake_db.account_adjustments.insert_one.assert_not_awaited()


def test_reconciliation_does_not_create_a_zero_adjustment(monkeypatch):
    fake_db = reconciliation_db()
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(server.reconcile_account_balance(
        "wallet-1",
        server.AccountReconciliationIn(
            actual_balance=100,
            expected_balance=100,
        ),
        user={"id": "user-1", "currency": "EUR"},
        idempotency_key=None,
    ))

    assert result == {
        "ok": True,
        "adjusted": False,
        "difference": 0.0,
        "current_balance": 100.0,
        "currency": "EUR",
    }
    fake_db.account_adjustments.insert_one.assert_not_awaited()


def test_opening_balance_cannot_be_rewritten_after_creation(monkeypatch):
    fake_db = SimpleNamespace(
        accounts=SimpleNamespace(
            find_one=AsyncMock(return_value={
                "id": "wallet-1",
                "user_id": "user-1",
                "name": "Revolut",
                "type": "checking",
                "currency": "EUR",
                "initial_balance": 100,
            }),
            update_one=AsyncMock(),
        ),
    )
    monkeypatch.setattr(server, "db", fake_db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.update_account(
            "wallet-1",
            server.AccountIn(
                name="Revolut",
                type="checking",
                initial_balance=90,
                currency="EUR",
            ),
            user={"id": "user-1", "currency": "EUR"},
        ))

    assert exc.value.status_code == 400
    assert "conciliação" in exc.value.detail
    fake_db.accounts.update_one.assert_not_awaited()
