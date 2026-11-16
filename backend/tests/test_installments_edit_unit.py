import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-secret-for-installments")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10")
os.environ.setdefault("DB_NAME", "crelith_installments_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def purchase(total=300, count=3, start=1):
    return {
        "id": "purchase-1", "total_amount": total, "installments": count,
        "first_date": "2026-11-15", "start_number": start,
    }


def parcel(number, amount=100, status="pending", date="2026-11-15"):
    return {
        "id": f"parcel-{number}", "number": number, "total": 3,
        "amount": amount, "due_date": date, "status": status,
        "paid_at": "2026-11-16T10:00:00" if status == "paid" else None,
    }


def test_correct_total_without_deleting_installment_ids():
    old = [parcel(1), parcel(2), parcel(3)]
    new = server.plan_installment_edit(purchase(), old, 600, 3, "2026-11-15")
    assert [i["id"] for i in new] == [i["id"] for i in old]
    assert [i["amount"] for i in new] == [200, 200, 200]
    assert [i["due_date"] for i in new] == ["2026-11-15", "2026-12-15", "2027-01-15"]


def test_paid_payment_is_preserved_and_only_pending_amounts_change():
    old = [parcel(1, status="paid"), parcel(2), parcel(3)]
    new = server.plan_installment_edit(purchase(), old, 500, 3, "2026-12-31")
    assert new[0]["amount"] == 100
    assert new[0]["status"] == "paid"
    assert new[0]["paid_at"] == old[0]["paid_at"]
    assert new[0]["due_date"] == old[0]["due_date"]
    assert [(i["amount"], i["due_date"]) for i in new[1:]] == [
        (200, "2027-01-31"), (200, "2027-02-28"),
    ]
    assert sum(i["amount"] for i in new) == 500


def test_increase_count_keeps_old_ids_and_creates_pending_slots():
    old = [parcel(1, status="paid"), parcel(2), parcel(3)]
    new = server.plan_installment_edit(purchase(), old, 500, 4, "2026-11-15")
    assert len(new) == 4
    assert new[0]["id"] == "parcel-1"
    assert new[-1]["number"] == 4
    assert "id" not in new[-1]
    assert new[-1]["status"] == "pending"
    assert round(sum(i["amount"] for i in new), 2) == 500


def test_cannot_shrink_past_paid_installment():
    old = [parcel(1), parcel(2), parcel(3, status="paid")]
    with pytest.raises(HTTPException) as exc:
        server.plan_installment_edit(purchase(), old, 300, 2, "2026-11-15")
    assert exc.value.status_code == 409


def test_cannot_reduce_total_below_paid_amount():
    old = [parcel(1, status="paid"), parcel(2), parcel(3)]
    with pytest.raises(HTTPException) as exc:
        server.plan_installment_edit(purchase(), old, 50, 3, "2026-11-15")
    assert exc.value.status_code == 409


def test_implicit_prior_payments_are_not_reallocated():
    old = [parcel(3), parcel(4), parcel(5), parcel(6)]
    old[0]["due_date"] = "2026-11-15"
    current = purchase(total=600, count=6, start=3)
    new = server.plan_installment_edit(current, old, 800, 6, "2026-11-15")
    assert [i["number"] for i in new] == [3, 4, 5, 6]
    assert [i["amount"] for i in new] == [150, 150, 150, 150]
    assert sum(i["amount"] for i in new) + 200 == 800


def test_fully_paid_plan_cannot_change_amount_without_more_installments():
    old = [parcel(1, status="paid"), parcel(2, status="paid"), parcel(3, status="paid")]
    with pytest.raises(HTTPException) as exc:
        server.plan_installment_edit(purchase(), old, 400, 3, "2026-11-15")
    assert exc.value.status_code == 409


@pytest.mark.parametrize("invalid", ["2026-31-99", "", "tomorrow"])
def test_date_validation(invalid):
    with pytest.raises(HTTPException) as exc:
        server.plan_installment_edit(purchase(), [parcel(1), parcel(2), parcel(3)], 300, 3, invalid)
    assert exc.value.status_code == 400
