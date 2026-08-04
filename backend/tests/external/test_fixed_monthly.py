"""
Tests for the 'Gasto fixo mensal' (fixed monthly expense average) feature.

Covers:
- GET /api/dashboard returns fixed_monthly_expense / fixed_monthly_income
- Frequency normalization: weekly = amount*52/12, monthly = amount, yearly = amount/12
- Toggling a recurrence off removes it from the calculation
- Recurrent transactions show recurrence_id and notes='(recorrente)' (badge data)
"""
import os
import datetime as dt
import calendar
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={
        "email": "wendy@demo.com", "password": "demo123"
    }, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}",
                      "Content-Type": "application/json"})
    return s


def _cleanup(client, created_ids):
    for rid in created_ids:
        try:
            client.delete(f"{API}/recurrences/{rid}", timeout=15)
        except Exception:
            pass
    # Also remove any TX materialized from those recurrences in current month
    try:
        r = client.get(f"{API}/transactions", timeout=20)
        if r.ok:
            for t in r.json():
                if t.get("recurrence_id") in created_ids:
                    client.delete(f"{API}/transactions/{t['id']}", timeout=15)
    except Exception:
        pass


def _next_run_safe_this_month():
    """Pick day in current month that's not the last day (to keep within horizon
    and avoid roll-over)."""
    today = dt.date.today()
    last = calendar.monthrange(today.year, today.month)[1]
    # day after today if possible, else today
    day = min(today.day + 1, last)
    return dt.date(today.year, today.month, day).isoformat()


# ------------------------- Tests -------------------------

def test_dashboard_has_fixed_monthly_fields(client):
    r = client.get(f"{API}/dashboard", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "fixed_monthly_expense" in data
    assert "fixed_monthly_income" in data
    assert isinstance(data["fixed_monthly_expense"], (int, float))
    assert isinstance(data["fixed_monthly_income"], (int, float))


def test_fixed_monthly_expense_normalization(client):
    """Create monthly €1200 + weekly €50; expect ~1200 + 50*52/12 = 1416.67"""
    created = []
    try:
        baseline = client.get(f"{API}/dashboard", timeout=30).json()
        base_exp = baseline["fixed_monthly_expense"]
        base_inc = baseline["fixed_monthly_income"]

        # Monthly recurrence - use far-future next_run to avoid materializing
        # interfering with month expense; but the calc reads recurrences table.
        far = (dt.date.today().replace(day=1) + dt.timedelta(days=400)).isoformat()

        r1 = client.post(f"{API}/recurrences", json={
            "type": "expense", "amount": 1200, "frequency": "monthly",
            "description": "TEST_Aluguel", "next_run": far, "active": True
        }, timeout=20)
        assert r1.status_code == 200, r1.text
        created.append(r1.json()["id"])

        r2 = client.post(f"{API}/recurrences", json={
            "type": "expense", "amount": 50, "frequency": "weekly",
            "description": "TEST_Mercado", "next_run": far, "active": True
        }, timeout=20)
        assert r2.status_code == 200, r2.text
        created.append(r2.json()["id"])

        # Income recurrence (yearly normalization)
        r3 = client.post(f"{API}/recurrences", json={
            "type": "income", "amount": 1200, "frequency": "yearly",
            "description": "TEST_Bonus", "next_run": far, "active": True
        }, timeout=20)
        assert r3.status_code == 200, r3.text
        created.append(r3.json()["id"])

        d = client.get(f"{API}/dashboard", timeout=30).json()

        expected_exp_delta = 1200 + 50 * 52 / 12  # ≈ 1416.67
        expected_inc_delta = 1200 / 12            # = 100.0

        # Compare deltas to tolerate other active recurrences already in DB
        assert abs((d["fixed_monthly_expense"] - base_exp) - expected_exp_delta) < 0.05, \
            f"expected delta ~{expected_exp_delta}, got {d['fixed_monthly_expense']-base_exp}"
        assert abs((d["fixed_monthly_income"] - base_inc) - expected_inc_delta) < 0.05, \
            f"expected delta ~{expected_inc_delta}, got {d['fixed_monthly_income']-base_inc}"
    finally:
        _cleanup(client, created)


def test_toggle_inactive_excluded_from_calc(client):
    created = []
    try:
        baseline = client.get(f"{API}/dashboard", timeout=30).json()
        base_exp = baseline["fixed_monthly_expense"]

        far = (dt.date.today().replace(day=1) + dt.timedelta(days=400)).isoformat()
        r = client.post(f"{API}/recurrences", json={
            "type": "expense", "amount": 300, "frequency": "monthly",
            "description": "TEST_Toggle", "next_run": far, "active": True
        }, timeout=20)
        assert r.status_code == 200
        rid = r.json()["id"]
        created.append(rid)

        d_on = client.get(f"{API}/dashboard", timeout=30).json()
        assert abs((d_on["fixed_monthly_expense"] - base_exp) - 300) < 0.05

        tg = client.post(f"{API}/recurrences/{rid}/toggle", timeout=20)
        assert tg.status_code == 200
        assert tg.json()["active"] is False

        d_off = client.get(f"{API}/dashboard", timeout=30).json()
        assert abs(d_off["fixed_monthly_expense"] - base_exp) < 0.05, \
            "Inactive recurrence still counted in fixed_monthly_expense"
    finally:
        _cleanup(client, created)


def test_recurrent_tx_carries_marker_for_badge(client):
    """Recorrência com next_run no mês corrente gera TX com notes='(recorrente)'
    e recurrence_id apontando para a origem — usados pelo badge no frontend."""
    created = []
    try:
        next_run = _next_run_safe_this_month()
        if next_run == dt.date.today().isoformat():
            # ok — will be 'paid'
            pass

        r = client.post(f"{API}/recurrences", json={
            "type": "expense", "amount": 17.42, "frequency": "monthly",
            "description": "TEST_Badge", "next_run": next_run, "active": True
        }, timeout=20)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        created.append(rid)

        # Force materialization by hitting /transactions
        txr = client.get(f"{API}/transactions", timeout=30)
        assert txr.status_code == 200
        txs = txr.json()
        matched = [t for t in txs if t.get("recurrence_id") == rid]
        assert matched, "No materialized transaction found for new recurrence"
        t = matched[0]
        assert t.get("notes") == "(recorrente)", f"notes={t.get('notes')!r}"
        assert t.get("recurrence_id") == rid
        assert t.get("amount") == 17.42
    finally:
        _cleanup(client, created)
