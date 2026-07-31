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


class StaticCursor:
    def __init__(self, items):
        self.items = items

    async def to_list(self, _limit):
        return list(self.items)


def payment_fixture(**overrides):
    payment = {
        "id": "payment-1",
        "expense_id": "expense-1",
        "expense_title": "Mercado",
        "debtor_id": "nathalia",
        "creditor_id": "marilia",
        "payer_account_id": "wallet-nathalia",
        "amount": 30,
        "currency": "EUR",
        "status": "sent",
        "active": True,
        "version": 1,
    }
    payment.update(overrides)
    return payment


def expense_fixture(**overrides):
    expense = {
        "id": "expense-1",
        "creator_id": "marilia",
        "payer_id": "marilia",
        "title": "Mercado",
        "currency": "EUR",
        "status": "open",
        "participants": [
            {
                "participant_id": "marilia",
                "user_id": "marilia",
                "owed": 60,
                "paid_back": False,
            },
            {
                "participant_id": "nathalia",
                "user_id": "nathalia",
                "owed": 60,
                "paid_back": False,
            },
        ],
    }
    expense.update(overrides)
    return expense


def test_settlement_wallet_legs_have_explicit_directions():
    payment = payment_fixture()

    debit = server.settlement_wallet_transaction(
        payment, "nathalia", "wallet-out", "out"
    )
    credit = server.settlement_wallet_transaction(
        payment, "marilia", "wallet-in", "in"
    )
    reversal = server.settlement_wallet_transaction(
        payment, "nathalia", "wallet-out", "reversal"
    )
    credit_reversal = server.settlement_wallet_transaction(
        payment, "marilia", "wallet-in", "credit_reversal"
    )

    assert debit["type"] == "transfer"
    assert debit["source"] == "settlement"
    assert debit["from_account_id"] == "wallet-out"
    assert debit["to_account_id"] is None
    assert credit["to_account_id"] == "wallet-in"
    assert credit["from_account_id"] is None
    assert reversal["to_account_id"] == "wallet-out"
    assert credit_reversal["from_account_id"] == "wallet-in"


def test_public_payment_never_exposes_private_wallet_ids():
    payment = payment_fixture(
        payer_account_id="private-payer-wallet",
        receiver_account_id="private-receiver-wallet",
    )

    public = server.public_settlement_payment(payment, "nathalia")

    assert public["is_sender"] is True
    assert public["receiver_wallet_recorded"] is True
    assert "payer_account_id" not in public
    assert "receiver_account_id" not in public


def test_payment_is_hidden_from_unrelated_shared_expense_member():
    assert server.public_settlement_payment(
        payment_fixture(),
        "third-participant",
    ) is None


def test_settlement_leg_retry_reuses_existing_transaction(monkeypatch):
    existing = {
        "id": "debit-1",
        "settlement_payment_id": "payment-1",
        "settlement_direction": "out",
        "user_id": "nathalia",
    }
    transactions = SimpleNamespace(
        find_one=AsyncMock(return_value=existing),
        insert_one=AsyncMock(),
    )
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(transactions=transactions),
    )

    result = asyncio.run(
        server.create_settlement_transaction_once(
            payment_fixture(),
            "nathalia",
            "wallet-nathalia",
            "out",
        )
    )

    assert result == existing
    transactions.insert_one.assert_not_awaited()


def test_rejection_creates_dispute_without_wallet_reversal(monkeypatch):
    payment = payment_fixture()
    payments = SimpleNamespace(
        find_one=AsyncMock(return_value=payment),
        update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1)),
    )
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(settlement_payments=payments),
    )
    notify = AsyncMock()
    monkeypatch.setattr(server, "push_notification", notify)
    create_leg = AsyncMock()
    monkeypatch.setattr(server, "create_settlement_transaction_once", create_leg)

    result = asyncio.run(
        server.reject_settlement_payment(
            "payment-1",
            server.SettlementPaymentActionIn(reason="Não localizado"),
            user={"id": "marilia", "name": "Marilia"},
        )
    )

    assert result == {
        "ok": True,
        "status": "disputed",
        "wallet_reversed": False,
    }
    update = payments.update_one.await_args.args[1]["$set"]
    assert update["status"] == "disputed"
    assert update["rejection_reason"] == "Não localizado"
    create_leg.assert_not_awaited()


def test_cancellation_records_reversal_instead_of_deleting_debit(monkeypatch):
    payment = payment_fixture()
    payments = SimpleNamespace(
        find_one=AsyncMock(return_value=payment),
        update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1)),
    )
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(settlement_payments=payments),
    )
    monkeypatch.setattr(server, "push_notification", AsyncMock())
    create_leg = AsyncMock(return_value={"id": "reversal-1"})
    monkeypatch.setattr(server, "create_settlement_transaction_once", create_leg)

    result = asyncio.run(
        server.cancel_settlement_payment(
            "payment-1",
            server.SettlementPaymentActionIn(reason="Registro incorreto"),
            user={"id": "nathalia", "name": "Nathalia"},
        )
    )

    assert result["status"] == "cancelled"
    assert result["reversed"] is True
    create_leg.assert_awaited_once_with(
        payment,
        "nathalia",
        "wallet-nathalia",
        "reversal",
    )
    final_update = payments.update_one.await_args_list[1].args[1]["$set"]
    assert final_update["reversal_transaction_id"] == "reversal-1"
    assert final_update["cancellation_reason"] == "Registro incorreto"


def test_confirmation_can_skip_receiver_wallet(monkeypatch):
    payment = payment_fixture(amount=30)
    expense = expense_fixture()
    payments = SimpleNamespace(
        find_one=AsyncMock(return_value=payment),
        update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1)),
    )
    shared_expenses = SimpleNamespace(find_one=AsyncMock(return_value=expense))
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            settlement_payments=payments,
            shared_expenses=shared_expenses,
        ),
    )
    monkeypatch.setattr(server, "push_notification", AsyncMock())
    create_leg = AsyncMock()
    monkeypatch.setattr(server, "create_settlement_transaction_once", create_leg)
    monkeypatch.setattr(
        server,
        "confirmed_settlement_total",
        AsyncMock(return_value=30),
    )
    confirm_debt = AsyncMock()
    monkeypatch.setattr(server, "confirm_shared_participant", confirm_debt)

    result = asyncio.run(
        server.confirm_settlement_payment(
            "payment-1",
            server.SettlementPaymentConfirmIn(account_id=None),
            user={"id": "marilia", "name": "Marilia", "currency": "EUR"},
        )
    )

    assert result["status"] == "confirmed"
    assert result["wallet_recorded"] is False
    assert result["debt_completed"] is False
    assert result["remaining_amount"] == 30
    create_leg.assert_not_awaited()
    confirm_debt.assert_not_awaited()


def test_repeated_confirmation_is_idempotent(monkeypatch):
    confirmed = payment_fixture(
        status="confirmed",
        active=False,
        receiver_account_id="wallet-marilia",
    )
    payments = SimpleNamespace(
        find_one=AsyncMock(side_effect=[None, confirmed]),
    )
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(settlement_payments=payments),
    )
    create_leg = AsyncMock()
    monkeypatch.setattr(server, "create_settlement_transaction_once", create_leg)

    result = asyncio.run(
        server.confirm_settlement_payment(
            "payment-1",
            server.SettlementPaymentConfirmIn(account_id="another-wallet"),
            user={"id": "marilia", "name": "Marilia", "currency": "EUR"},
        )
    )

    assert result["already_confirmed"] is True
    assert result["wallet_recorded"] is True
    create_leg.assert_not_awaited()


def test_final_partial_payment_closes_original_debt(monkeypatch):
    payment = payment_fixture(amount=20)
    expense = expense_fixture()
    payments = SimpleNamespace(
        find_one=AsyncMock(return_value=payment),
        update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1)),
    )
    shared_expenses = SimpleNamespace(find_one=AsyncMock(return_value=expense))
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            settlement_payments=payments,
            shared_expenses=shared_expenses,
        ),
    )
    monkeypatch.setattr(server, "push_notification", AsyncMock())
    monkeypatch.setattr(
        server,
        "confirmed_settlement_total",
        AsyncMock(return_value=60),
    )
    confirm_debt = AsyncMock(return_value=(expense, True))
    monkeypatch.setattr(server, "confirm_shared_participant", confirm_debt)

    result = asyncio.run(
        server.confirm_settlement_payment(
            "payment-1",
            server.SettlementPaymentConfirmIn(account_id=None),
            user={"id": "marilia", "name": "Marilia", "currency": "EUR"},
        )
    )

    assert result["debt_completed"] is True
    assert result["remaining_amount"] == 0
    confirm_debt.assert_awaited_once_with(expense, "nathalia")


def test_new_payment_cannot_exceed_remaining_debt(monkeypatch):
    expense = expense_fixture()
    shared_expenses = SimpleNamespace(find_one=AsyncMock(return_value=expense))
    users = SimpleNamespace(find_one=AsyncMock(return_value={
        "id": "marilia",
        "name": "Marilia",
    }))
    payments = SimpleNamespace(insert_one=AsyncMock())
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            shared_expenses=shared_expenses,
            users=users,
            settlement_payments=payments,
        ),
    )
    monkeypatch.setattr(server, "validate_settlement_account", AsyncMock())
    monkeypatch.setattr(
        server,
        "confirmed_settlement_total",
        AsyncMock(return_value=20),
    )

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(
            server.start_settlement_payment(
                server.SettlementPaymentStartIn(
                    expense_id="expense-1",
                    account_id="wallet-nathalia",
                    amount=50,
                ),
                user={
                    "id": "nathalia",
                    "name": "Nathalia",
                    "currency": "EUR",
                },
                idempotency_key=None,
            )
        )

    assert exc.value.status_code == 409
    assert "superar" in exc.value.detail
    payments.insert_one.assert_not_awaited()
