import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-secret-for-goals")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10")
os.environ.setdefault("DB_NAME", "crelith_goal_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

USER = {"id": "user-1", "currency": "EUR"}


def goal_db(goal, withdraw_allowed=True):
    return SimpleNamespace(
        goals=SimpleNamespace(
            find_one=AsyncMock(return_value=dict(goal)),
            update_one=AsyncMock(return_value=SimpleNamespace(modified_count=1 if withdraw_allowed else 0)),
        ),
        accounts=SimpleNamespace(find_one=AsyncMock(side_effect=lambda q, *a, **k: {"id": q["id"], "currency": "EUR"})),
        transactions=SimpleNamespace(insert_one=AsyncMock()),
        goal_events=SimpleNamespace(insert_one=AsyncMock()),
    )


@pytest.fixture(autouse=True)
def no_rates(monkeypatch):
    monkeypatch.setattr(server, "monetary_metadata", AsyncMock(return_value={"currency": "EUR"}))


def run(coro):
    return asyncio.run(coro)


def test_contribution_from_the_goals_own_wallet_moves_no_money(monkeypatch):
    db = goal_db({"id": "g", "title": "Reserva", "current_amount": 0, "account_id": "poupanca"})
    monkeypatch.setattr(server, "db", db)
    run(server.contribute_goal("g", server.ContributeIn(amount=100, from_account_id="poupanca"), USER))
    db.transactions.insert_one.assert_not_awaited()
    assert db.goals.update_one.await_args.args[1] == {"$inc": {"current_amount": 100}}


def test_contribution_from_another_wallet_is_a_transfer(monkeypatch):
    db = goal_db({"id": "g", "title": "Reserva", "current_amount": 0, "account_id": "poupanca"})
    monkeypatch.setattr(server, "db", db)
    run(server.contribute_goal("g", server.ContributeIn(amount=100, from_account_id="corrente"), USER))
    tx = db.transactions.insert_one.await_args.args[0]
    assert (tx["type"], tx["from_account_id"], tx["to_account_id"]) == ("transfer", "corrente", "poupanca")


def test_contribution_without_linked_wallet_leaves_the_wallets(monkeypatch):
    db = goal_db({"id": "g", "title": "Viagem", "current_amount": 0, "account_id": None})
    monkeypatch.setattr(server, "db", db)
    run(server.contribute_goal("g", server.ContributeIn(amount=50, from_account_id="corrente"), USER))
    assert db.transactions.insert_one.await_args.args[0]["type"] == "expense"


def test_withdrawal_into_the_goals_own_wallet_moves_no_money(monkeypatch):
    db = goal_db({"id": "g", "title": "Reserva", "current_amount": 300, "account_id": "poupanca"})
    monkeypatch.setattr(server, "db", db)
    run(server.withdraw_goal("g", server.WithdrawIn(amount=100, to_account_id="poupanca"), USER))
    db.transactions.insert_one.assert_not_awaited()


def test_withdrawal_is_atomic_and_never_goes_below_zero(monkeypatch):
    db = goal_db({"id": "g", "title": "Reserva", "current_amount": 300, "account_id": "poupanca"}, withdraw_allowed=False)
    monkeypatch.setattr(server, "db", db)
    with pytest.raises(HTTPException) as exc:
        run(server.withdraw_goal("g", server.WithdrawIn(amount=200, to_account_id="corrente"), USER))
    assert exc.value.status_code == 400
    query, update = db.goals.update_one.await_args.args
    assert "$gte" in query["current_amount"] and update == {"$inc": {"current_amount": -200}}
    db.transactions.insert_one.assert_not_awaited()
