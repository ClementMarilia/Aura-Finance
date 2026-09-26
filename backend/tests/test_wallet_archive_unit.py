import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-secret-for-wallet-archive")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10")
os.environ.setdefault("DB_NAME", "crelith_wallet_archive_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

USER = {"id": "user-1", "currency": "EUR"}


def cursor(items):
    c = MagicMock()
    c.to_list = AsyncMock(return_value=items)
    return c


def archive_db(recurrences=0, purchases=(), pending=0, exists=True):
    return SimpleNamespace(
        accounts=SimpleNamespace(
            find_one=AsyncMock(return_value={"id": "acc-1", "currency": "EUR"} if exists else None),
            update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1 if exists else 0)),
        ),
        recurrences=SimpleNamespace(count_documents=AsyncMock(return_value=recurrences)),
        installment_purchases=SimpleNamespace(find=MagicMock(return_value=cursor([{"id": p} for p in purchases]))),
        installments=SimpleNamespace(count_documents=AsyncMock(return_value=pending)),
    )


def with_balance(monkeypatch, balance):
    monkeypatch.setattr(server, "load_account_balance_breakdowns",
                        AsyncMock(return_value=[{"account_id": "acc-1", "current_balance": balance}]))


def test_empty_wallet_is_archived(monkeypatch):
    db = archive_db()
    monkeypatch.setattr(server, "db", db)
    with_balance(monkeypatch, 0)
    assert asyncio.run(server.archive_account("acc-1", USER))["archived"] is True
    update = db.accounts.update_one.await_args.args[1]["$set"]
    assert update["archived"] is True and update["archived_at"]


@pytest.mark.parametrize(
    ("balance", "db_kwargs", "reason"),
    [
        (12.5, {}, "saldo"),
        (0, {"recurrences": 1}, "recorrência"),
        (0, {"purchases": ["p-1"], "pending": 3}, "parcelas pendentes"),
    ],
)
def test_archive_is_refused_while_money_can_still_move(monkeypatch, balance, db_kwargs, reason):
    db = archive_db(**db_kwargs)
    monkeypatch.setattr(server, "db", db)
    with_balance(monkeypatch, balance)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.archive_account("acc-1", USER))
    assert exc.value.status_code == 409
    assert reason in exc.value.detail
    db.accounts.update_one.assert_not_awaited()


def test_unarchive_and_unknown_wallet(monkeypatch):
    monkeypatch.setattr(server, "db", archive_db())
    assert asyncio.run(server.unarchive_account("acc-1", USER))["archived"] is False
    monkeypatch.setattr(server, "db", archive_db(exists=False))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.unarchive_account("nope", USER))
    assert exc.value.status_code == 404


def test_listing_hides_archived_wallets_unless_they_hold_money(monkeypatch):
    accounts = [
        {"id": "active", "currency": "EUR"},
        {"id": "archived-empty", "currency": "EUR", "archived": True},
        {"id": "archived-with-money", "currency": "EUR", "archived": True},
    ]
    monkeypatch.setattr(server, "db", SimpleNamespace(accounts=SimpleNamespace(
        find=MagicMock(side_effect=lambda *a, **k: cursor([dict(x) for x in accounts])))))
    balances = {"active": 10, "archived-empty": 0, "archived-with-money": 5}
    monkeypatch.setattr(server, "load_account_balance_breakdowns", AsyncMock(side_effect=lambda accs, user: [
        {"account_id": a["id"], "current_balance": balances[a["id"]]} for a in accs
    ]))

    default = asyncio.run(server.list_accounts(user=USER))
    assert [a["id"] for a in default] == ["active", "archived-with-money"]

    everything = asyncio.run(server.list_accounts(include_archived=True, user=USER))
    assert [a["id"] for a in everything] == ["active", "archived-empty", "archived-with-money"]
    assert [a["archived"] for a in everything] == [False, True, True]
