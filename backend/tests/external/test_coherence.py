"""Iteration 6: Cross-section coherence — installments + recurrences feed dashboard,
receivables scoped by month, transactions unify installments+recurrences."""
import os
import pytest
import requests
from datetime import date, timedelta
import calendar

from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
EMAIL = "wendy@demo.com"
PASSWORD = "demo123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _today():
    return date.today()


def _next_month(d: date) -> date:
    m = d.month + 1
    y = d.year + (1 if m > 12 else 0)
    m = 1 if m > 12 else m
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


def _dashboard(h, y, m):
    r = requests.get(f"{BASE}/api/dashboard?year={y}&month={m}", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# --- TEST 1: Dashboard coerente (installment + recurrence affect expense/balance/installments_month_total) ---
def test_dashboard_includes_installment_and_recurrence(h):
    today = _today()
    y, m = today.year, today.month
    base = _dashboard(h, y, m)
    base_exp = base["expense"]
    base_bal = base["balance"]
    base_inst = base["installments_month_total"]

    # Create installment 3x 300 starting this month
    first = date(y, m, min(today.day, 28)).isoformat()
    pr = requests.post(f"{BASE}/api/installments/purchases", headers=h, json={
        "description": "TEST_COH_Parcelamento", "total_amount": 900.0,
        "installments": 3, "first_date": first,
    }, timeout=30)
    assert pr.status_code == 200, pr.text
    pid = pr.json()["id"]

    # Create monthly recurrence expense 80 with next_run this month
    rr = requests.post(f"{BASE}/api/recurrences", headers=h, json={
        "type": "expense", "amount": 80.0, "frequency": "monthly",
        "description": "TEST_COH_Recorrencia", "next_run": first, "active": True,
    }, timeout=30)
    assert rr.status_code == 200, rr.text
    rid = rr.json()["id"]

    try:
        after = _dashboard(h, y, m)
        d_exp = round(after["expense"] - base_exp, 2)
        d_bal = round(after["balance"] - base_bal, 2)
        d_inst = round(after["installments_month_total"] - base_inst, 2)

        # 1 parcel (300) + 1 recurrence (80) = 380 extra expense
        assert d_exp == 380.0, f"expected +380 expense, got +{d_exp} (base={base_exp}, after={after['expense']})"
        assert d_bal == -380.0, f"expected -380 balance, got {d_bal}"
        assert d_inst == 300.0, f"expected +300 installments_month_total, got +{d_inst}"
    finally:
        requests.delete(f"{BASE}/api/installments/purchases/{pid}", headers=h, timeout=30)
        requests.delete(f"{BASE}/api/recurrences/{rid}", headers=h, timeout=30)
        # remove TX materialized by the recurrence this month
        tx = requests.get(f"{BASE}/api/transactions?year={y}&month={m}", headers=h, timeout=30).json()
        for t in tx:
            if t.get("source") == "recurrence" and t.get("description") == "TEST_COH_Recorrencia":
                requests.delete(f"{BASE}/api/transactions/{t['id']}", headers=h, timeout=30)


# --- TEST 2: Receivable scoped by month ---
def test_receivable_scoped_by_month(h):
    today = _today()
    y, m = today.year, today.month
    nm = _next_month(date(y, m, 15))
    ny, nmm = nm.year, nm.month

    base_cur = _dashboard(h, y, m)["receivable_total"]
    base_next = _dashboard(h, ny, nmm)["receivable_total"]

    # Receivable due NEXT month
    rec = requests.post(f"{BASE}/api/receivables", headers=h, json={
        "person": "TEST_COH_Pessoa", "amount": 500.0,
        "due_date": nm.isoformat(), "description": "TEST_COH_Recebivel",
    }, timeout=30)
    assert rec.status_code == 200, rec.text
    rid = rec.json()["id"]

    try:
        after_cur = _dashboard(h, y, m)["receivable_total"]
        after_next = _dashboard(h, ny, nmm)["receivable_total"]
        d_cur = round(after_cur - base_cur, 2)
        d_next = round(after_next - base_next, 2)

        assert d_cur == 0.0, f"current-month receivable should NOT include future receivable, got delta {d_cur}"
        assert d_next == 500.0, f"next-month receivable should include it, got delta {d_next}"
    finally:
        requests.delete(f"{BASE}/api/receivables/{rid}", headers=h, timeout=30)


# --- TEST 3: Transactions list merges installments and recurrences ---
def test_transactions_unified_listing(h):
    today = _today()
    y, m = today.year, today.month
    first = date(y, m, min(today.day, 28)).isoformat()

    pr = requests.post(f"{BASE}/api/installments/purchases", headers=h, json={
        "description": "TEST_COH_UnifiedPurchase", "total_amount": 600.0,
        "installments": 2, "first_date": first,
    }, timeout=30).json()
    pid = pr["id"]
    rr = requests.post(f"{BASE}/api/recurrences", headers=h, json={
        "type": "expense", "amount": 45.0, "frequency": "monthly",
        "description": "TEST_COH_UnifiedRec", "next_run": first, "active": True,
    }, timeout=30).json()
    rid = rr["id"]

    try:
        txs = requests.get(f"{BASE}/api/transactions?year={y}&month={m}", headers=h, timeout=30).json()
        inst_rows = [t for t in txs if t.get("source") == "installment" and "TEST_COH_UnifiedPurchase" in t.get("description", "")]
        rec_rows = [t for t in txs if t.get("source") == "recurrence" and t.get("description") == "TEST_COH_UnifiedRec"]

        assert len(inst_rows) == 1, f"expected 1 installment row for this month, got {len(inst_rows)}"
        ir = inst_rows[0]
        assert ir["editable"] is False, "installment row must be read-only"
        assert "(1/2)" in ir["description"], f"description should contain (n/total), got {ir['description']}"
        assert ir["amount"] == 300.0
        assert ir["type"] == "expense"

        assert len(rec_rows) >= 1, "expected at least 1 recurrence-sourced transaction this month"
        assert rec_rows[0]["editable"] is True  # materialized TX itself is still editable
        assert rec_rows[0].get("recurrence_id") == rid
    finally:
        requests.delete(f"{BASE}/api/installments/purchases/{pid}", headers=h, timeout=30)
        requests.delete(f"{BASE}/api/recurrences/{rid}", headers=h, timeout=30)
        tx = requests.get(f"{BASE}/api/transactions?year={y}&month={m}", headers=h, timeout=30).json()
        for t in tx:
            if t.get("source") == "recurrence" and t.get("description") == "TEST_COH_UnifiedRec":
                requests.delete(f"{BASE}/api/transactions/{t['id']}", headers=h, timeout=30)


# --- TEST 4: Future month materializes recurrence on demand ---
def test_future_month_materializes_recurrence(h):
    today = _today()
    # use a month 2 ahead to avoid clash with this-month materialization
    fm = _next_month(_next_month(date(today.year, today.month, 15)))
    fy, fmonth = fm.year, fm.month
    next_run = date(fy, fmonth, 10).isoformat()

    rr = requests.post(f"{BASE}/api/recurrences", headers=h, json={
        "type": "expense", "amount": 33.33, "frequency": "monthly",
        "description": "TEST_COH_Future", "next_run": next_run, "active": True,
    }, timeout=30).json()
    rid = rr["id"]

    try:
        # Visiting current month should NOT materialize it (next_run is future)
        cur_txs = requests.get(
            f"{BASE}/api/transactions?year={today.year}&month={today.month}",
            headers=h, timeout=30).json()
        in_current = [t for t in cur_txs if t.get("description") == "TEST_COH_Future"]
        assert len(in_current) == 0, "future recurrence should not appear in current month yet"

        # Visiting future month should materialize
        fut_txs = requests.get(f"{BASE}/api/transactions?year={fy}&month={fmonth}",
                               headers=h, timeout=30).json()
        in_future = [t for t in fut_txs if t.get("description") == "TEST_COH_Future"]
        assert len(in_future) >= 1, "recurrence should be materialized when visiting its month"
        assert in_future[0]["status"] == "pending"
        assert in_future[0].get("source") == "recurrence"
    finally:
        requests.delete(f"{BASE}/api/recurrences/{rid}", headers=h, timeout=30)
        # clean any materialized TX
        for yy, mm in [(today.year, today.month), (fy, fmonth)]:
            tx = requests.get(f"{BASE}/api/transactions?year={yy}&month={mm}", headers=h, timeout=30).json()
            for t in tx:
                if t.get("description") == "TEST_COH_Future":
                    requests.delete(f"{BASE}/api/transactions/{t['id']}", headers=h, timeout=30)


# --- TEST 5: fixed_monthly_expense remains separate normalized average (regression) ---
def test_fixed_monthly_expense_is_normalized_average(h):
    today = _today()
    y, m = today.year, today.month
    base = _dashboard(h, y, m)["fixed_monthly_expense"]
    # add weekly 10 -> contributes 10*52/12 ≈ 43.33 to fixed_monthly_expense
    rr = requests.post(f"{BASE}/api/recurrences", headers=h, json={
        "type": "expense", "amount": 10.0, "frequency": "weekly",
        "description": "TEST_COH_FixedAvg",
        "next_run": (today + timedelta(days=400)).isoformat(),  # far future, no materialize this month
        "active": True,
    }, timeout=30).json()
    rid = rr["id"]
    try:
        after = _dashboard(h, y, m)["fixed_monthly_expense"]
        delta = round(after - base, 2)
        assert abs(delta - round(10 * 52 / 12, 2)) < 0.05, f"weekly recurrence should add ~43.33, got {delta}"
    finally:
        requests.delete(f"{BASE}/api/recurrences/{rid}", headers=h, timeout=30)
