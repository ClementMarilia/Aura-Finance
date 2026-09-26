import asyncio
import os
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-secret-for-installments")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10")
os.environ.setdefault("DB_NAME", "crelith_installments_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

USER = {"id": "user-1"}


@pytest.mark.parametrize(("total", "count"), [(100, 3), (1000, 7), (99.99, 12), (10, 1), (0.05, 4)])
def test_parcels_add_up_exactly_to_the_total(total, count):
    amounts = server.installment_amounts(total, count)
    assert len(amounts) == count
    assert round(sum(amounts), 2) == round(total, 2)
    assert round(max(amounts) - min(amounts), 2) <= 0.01


def test_leftover_cents_are_spread():
    assert server.installment_amounts(100, 3) == [33.34, 33.33, 33.33]
    assert server.installment_amounts(1000, 7) == [142.86, 142.86, 142.86, 142.86, 142.86, 142.85, 142.85]


def test_due_dates_keep_the_day_and_clamp_to_month_end():
    first = date(2026, 1, 31)
    assert [server.installment_due_date(first, i) for i in range(5)] == [
        date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30), date(2026, 5, 31),
    ]
    assert server.installment_due_date(date(2027, 12, 29), 2) == date(2028, 2, 29)
    assert server.installment_due_date(date(2026, 11, 15), 3) == date(2027, 2, 15)


def purchase_db(paid=0, exists=True):
    return SimpleNamespace(
        installment_purchases=SimpleNamespace(
            find_one=AsyncMock(return_value={"id": "p-1"} if exists else None),
            delete_one=AsyncMock(),
        ),
        installments=SimpleNamespace(
            count_documents=AsyncMock(return_value=paid),
            delete_many=AsyncMock(),
        ),
    )


def test_purchase_without_paid_parcels_is_deleted(monkeypatch):
    db = purchase_db()
    monkeypatch.setattr(server, "db", db)
    assert asyncio.run(server.delete_purchase("p-1", USER)) == {"ok": True}
    db.installments.delete_many.assert_awaited_once()


def test_purchase_with_paid_parcels_is_kept(monkeypatch):
    db = purchase_db(paid=2)
    monkeypatch.setattr(server, "db", db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.delete_purchase("p-1", USER))
    assert exc.value.status_code == 409
    assert "2 parcela(s) paga(s)" in exc.value.detail
    db.installment_purchases.delete_one.assert_not_awaited()
    db.installments.delete_many.assert_not_awaited()


def test_unknown_purchase_is_404(monkeypatch):
    monkeypatch.setattr(server, "db", purchase_db(exists=False))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.delete_purchase("nope", USER))
    assert exc.value.status_code == 404
