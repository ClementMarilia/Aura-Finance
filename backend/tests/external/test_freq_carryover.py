"""Tests for quarterly/semiannual frequencies and include_carryover filter."""
import os
import requests
from datetime import date, timedelta

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://aura-pay.preview.emergentagent.com").rstrip("/")


def _login():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "wendy@demo.com", "password": "demo123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


TOKEN = _login()
H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def _get_default_account():
    r = requests.get(f"{BASE}/api/accounts", headers=H)
    assert r.status_code == 200
    accs = r.json()
    return accs[0]["id"] if accs else None


ACC = _get_default_account()


def test_create_quarterly_recurrence():
    payload = {
        "type": "expense",
        "amount": 50,
        "description": "TEST_QuartRec",
        "start_date": date.today().isoformat(),
        "next_run": date.today().isoformat(),
        "frequency": "quarterly",
        "account_id": ACC,
    }
    r = requests.post(f"{BASE}/api/recurrences", json=payload, headers=H)
    assert r.status_code in (200, 201), r.text
    data = r.json()
    assert data["frequency"] == "quarterly"
    rid = data["id"]
    # cleanup
    requests.delete(f"{BASE}/api/recurrences/{rid}", headers=H)


def test_create_semiannual_recurrence():
    payload = {
        "type": "expense",
        "amount": 60,
        "description": "TEST_SemiRec",
        "start_date": date.today().isoformat(),
        "next_run": date.today().isoformat(),
        "frequency": "semiannual",
        "account_id": ACC,
    }
    r = requests.post(f"{BASE}/api/recurrences", json=payload, headers=H)
    assert r.status_code in (200, 201), r.text
    data = r.json()
    assert data["frequency"] == "semiannual"
    rid = data["id"]
    requests.delete(f"{BASE}/api/recurrences/{rid}", headers=H)


def test_invalid_frequency_rejected():
    payload = {
        "type": "expense",
        "amount": 10,
        "description": "TEST_bad",
        "start_date": date.today().isoformat(),
        "frequency": "biweekly",
        "account_id": ACC,
    }
    r = requests.post(f"{BASE}/api/recurrences", json=payload, headers=H)
    assert r.status_code == 422


def test_transactions_include_carryover_false_excludes_other_months():
    # Create an expense in current month
    today = date.today()
    tx = {
        "type": "expense",
        "amount": 12.34,
        "description": "TEST_CarryFilter",
        "date": today.isoformat(),
        "status": "pending",
        "account_id": ACC,
    }
    r = requests.post(f"{BASE}/api/transactions", json=tx, headers=H)
    assert r.status_code in (200, 201), r.text
    tid = r.json()["id"]

    # Query a *future* month with include_carryover=false -> should NOT include current-month pending
    future = (today.replace(day=1) + timedelta(days=62))
    fy, fm = future.year, future.month
    r_off = requests.get(
        f"{BASE}/api/transactions?year={fy}&month={fm}&include_carryover=false",
        headers=H,
    )
    assert r_off.status_code == 200
    ids_off = {t["id"] for t in r_off.json()}
    assert tid not in ids_off, "carry-over item leaked when include_carryover=false"

    # With include_carryover=true (default) — pending overdue may appear
    r_on = requests.get(
        f"{BASE}/api/transactions?year={fy}&month={fm}&include_carryover=true",
        headers=H,
    )
    assert r_on.status_code == 200

    requests.delete(f"{BASE}/api/transactions/{tid}", headers=H)
