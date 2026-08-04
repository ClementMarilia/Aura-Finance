"""
Tests for the new installment behavior:
- /transactions returns only the parcel of the requested month + overdue pending (no future)
- POST /installments/{id}/pay marks parcel as paid and removes it from later /transactions calls
- Installment purchase keeps installments_list (so UI can collapse/expand)
- Dashboard still includes month installment in installments_month_total
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
EMAIL = "wendy@demo.com"
PASSWORD = "demo123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _cleanup_purchase(H, pid):
    try:
        requests.delete(f"{BASE_URL}/api/installments/purchases/{pid}",
                        headers=H, timeout=20)
    except Exception:
        pass


def test_installments_only_month_and_overdue(H):
    """6x starting in 2026-04 → in 2026-06 transactions should return parcels 1,2,3 (1,2 overdue), not 4,5,6."""
    tag = f"TEST_COLLAPSE_{uuid.uuid4().hex[:6]}"
    payload = {
        "description": tag,
        "total_amount": 600.0,
        "installments": 6,
        "first_date": "2026-04-10",
        "category_id": None, "account_id": None, "payment_method": "credit_card",
    }
    r = requests.post(f"{BASE_URL}/api/installments/purchases",
                      headers=H, json=payload, timeout=30)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    try:
        # Purchase includes installments_list (for UI cards)
        lp = requests.get(f"{BASE_URL}/api/installments/purchases",
                          headers=H, timeout=20).json()
        cur = next(x for x in lp if x["id"] == pid)
        assert len(cur["installments_list"]) == 6
        assert cur["installments_list"][0]["number"] == 1

        # GET /transactions for 2026-06 → should include 1/6, 2/6, 3/6 only (no 4,5,6)
        rt = requests.get(f"{BASE_URL}/api/transactions?year=2026&month=6",
                          headers=H, timeout=30).json()
        parcels = [x for x in rt if x.get("source") == "installment"
                   and x.get("purchase_id") == pid]
        nums = sorted(p["installment_number"] for p in parcels)
        assert nums == [1, 2, 3], f"expected [1,2,3], got {nums}; rows={parcels}"

        # 1 and 2 should be overdue, 3 not (current month)
        by_num = {p["installment_number"]: p for p in parcels}
        assert by_num[1]["overdue"] is True
        assert by_num[2]["overdue"] is True
        assert by_num[3]["overdue"] is False
        # Description carries n/total
        assert "(1/6)" in by_num[1]["description"]
        # Editable False (linked, can't be edited from /transactions)
        assert all(p["editable"] is False for p in parcels)

        # Future months (4,5,6) NOT in the response
        future_nums = [p["number"] for p in cur["installments_list"]
                       if p["number"] >= 4]
        assert future_nums == [4, 5, 6]
        assert all(n not in nums for n in future_nums)
    finally:
        _cleanup_purchase(H, pid)


def test_pay_installment_from_transactions(H):
    """Paying parcel 1/6 must remove it from /transactions (since it's no longer pending and is in a past month)."""
    tag = f"TEST_COLLAPSE_PAY_{uuid.uuid4().hex[:6]}"
    payload = {
        "description": tag,
        "total_amount": 300.0,
        "installments": 6,
        "first_date": "2026-04-10",
        "category_id": None, "account_id": None, "payment_method": "credit_card",
    }
    r = requests.post(f"{BASE_URL}/api/installments/purchases",
                      headers=H, json=payload, timeout=30)
    assert r.status_code == 200
    pid = r.json()["id"]
    try:
        # Get parcel ids
        lp = requests.get(f"{BASE_URL}/api/installments/purchases",
                          headers=H, timeout=20).json()
        cur = next(x for x in lp if x["id"] == pid)
        first_iid = next(i["id"] for i in cur["installments_list"]
                         if i["number"] == 1)

        # Mark paid
        rp = requests.post(f"{BASE_URL}/api/installments/{first_iid}/pay",
                           headers=H, timeout=20)
        assert rp.status_code == 200, rp.text

        # /transactions for 2026-06 should NOT contain parcel 1 anymore
        rt = requests.get(f"{BASE_URL}/api/transactions?year=2026&month=6",
                          headers=H, timeout=30).json()
        nums = sorted(x["installment_number"] for x in rt
                      if x.get("source") == "installment"
                      and x.get("purchase_id") == pid)
        assert 1 not in nums, f"parcel 1 should be gone, got {nums}"
        # 2,3 remain (2 overdue, 3 current)
        assert nums == [2, 3]

        # Purchase reflects parcel 1 paid
        lp2 = requests.get(f"{BASE_URL}/api/installments/purchases",
                           headers=H, timeout=20).json()
        cur2 = next(x for x in lp2 if x["id"] == pid)
        p1 = next(i for i in cur2["installments_list"] if i["number"] == 1)
        assert p1["status"] == "paid"
    finally:
        _cleanup_purchase(H, pid)


def test_dashboard_installments_month_total_regression(H):
    """Dashboard installments_month_total must include the month parcel."""
    base = requests.get(f"{BASE_URL}/api/dashboard?year=2026&month=6",
                        headers=H, timeout=30).json()
    base_total = base.get("installments_month_total", 0)

    tag = f"TEST_COLLAPSE_DASH_{uuid.uuid4().hex[:6]}"
    payload = {
        "description": tag, "total_amount": 600.0, "installments": 6,
        "first_date": "2026-04-10", "category_id": None, "account_id": None,
        "payment_method": "credit_card",
    }
    r = requests.post(f"{BASE_URL}/api/installments/purchases",
                      headers=H, json=payload, timeout=30)
    assert r.status_code == 200
    pid = r.json()["id"]
    try:
        after = requests.get(f"{BASE_URL}/api/dashboard?year=2026&month=6",
                             headers=H, timeout=30).json()
        # 600/6 = 100 expected delta
        delta = round(after["installments_month_total"] - base_total, 2)
        assert delta == 100.0, f"expected delta 100, got {delta}"
    finally:
        _cleanup_purchase(H, pid)
