"""Test cases for the recurrence-in-current-month bug fix.

Bug: Recorrência com next_run em dia FUTURO do mês corrente não aparecia
em GET /api/dashboard (Despesa do mês) nem em GET /api/transactions.

Fix: materialize_recurrences agora materializa até o FIM do mês corrente.
- next_run <= hoje  -> status 'paid'
- hoje < next_run <= fim do mês -> status 'pending'
- next_run > fim do mês -> NÃO gera ainda

Hoje na env de teste = 2026-06-24.
"""
import os
import calendar
from datetime import date, timedelta
import pytest
import requests

# Run tests in this module on a single xdist worker to avoid cross-test
# interference on the same demo user (dashboard expense snapshots).
pytestmark = pytest.mark.xdist_group(name="recurrence_bug_serial")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://despesa-facil-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "wendy@demo.com"
PASSWORD = "demo123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login falhou: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def today_info(H):
    # Use the server's view of "today" indirectly via dashboard (defaults to current month)
    r = requests.get(f"{API}/dashboard", headers=H, timeout=30)
    assert r.status_code == 200
    # Assume container date; tests use real today
    t = date.today()
    last_day = calendar.monthrange(t.year, t.month)[1]
    return {"today": t, "last_day": last_day,
            "end_of_month": date(t.year, t.month, last_day)}


def _make_rec(H, next_run: date, desc: str, amount: float = 13.57):
    payload = {
        "type": "expense",
        "amount": amount,
        "description": desc,
        "frequency": "monthly",
        "next_run": next_run.isoformat(),
        "active": True,
    }
    r = requests.post(f"{API}/recurrences", headers=H, json=payload, timeout=30)
    assert r.status_code == 200, f"create rec falhou: {r.status_code} {r.text}"
    return r.json()


def _cleanup_rec_and_tx(H, rec_id: str):
    # Delete generated transactions linked to this recurrence
    txs = requests.get(f"{API}/transactions", headers=H, timeout=30).json()
    for t in txs:
        if t.get("recurrence_id") == rec_id:
            requests.delete(f"{API}/transactions/{t['id']}", headers=H, timeout=30)
    requests.delete(f"{API}/recurrences/{rec_id}", headers=H, timeout=30)


def _dashboard_expense(H):
    r = requests.get(f"{API}/dashboard", headers=H, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# --- Test 1: future day in current month -> pending + counted in dashboard expense
class TestFutureSameMonth:
    def test_future_day_current_month_creates_pending_and_appears_in_dashboard(self, H, today_info):
        t = today_info["today"]
        last_day = today_info["last_day"]
        # Pick a day strictly after today within this month
        if t.day >= last_day:
            pytest.skip("Hoje é o último dia do mês; sem dia futuro neste mês para testar.")
        future_day = min(t.day + 2, last_day)
        next_run = date(t.year, t.month, future_day)

        # baseline expense
        before = _dashboard_expense(H)["expense"]

        amount = 17.31
        rec = _make_rec(H, next_run, "TEST_REC_FUTURE_SAME_MONTH", amount=amount)
        try:
            # Dashboard should reflect the new expense
            after = _dashboard_expense(H)["expense"]
            assert round(after - before, 2) == amount, (
                f"Despesa do mês não aumentou pelo valor da recorrência futura. "
                f"before={before} after={after} expected_diff={amount}"
            )

            # Transactions: deve haver tx 'pending' com notes '(recorrente)' e data == next_run
            txs = requests.get(f"{API}/transactions", headers=H, timeout=30).json()
            matched = [x for x in txs if x.get("recurrence_id") == rec["id"]]
            assert len(matched) == 1, f"Esperava 1 tx, achei {len(matched)}: {matched}"
            tx = matched[0]
            assert tx["status"] == "pending", f"Esperava status pending, veio {tx['status']}"
            assert tx["notes"] == "(recorrente)"
            assert tx["date"] == next_run.isoformat()
            assert tx["type"] == "expense"
            assert tx["amount"] == amount

            # next_run da recorrência avançou para o próximo mês
            recs = requests.get(f"{API}/recurrences", headers=H, timeout=30).json()
            cur = next(x for x in recs if x["id"] == rec["id"])
            assert cur["next_run"] > next_run.isoformat(), (
                f"next_run não avançou: {cur['next_run']}"
            )
        finally:
            _cleanup_rec_and_tx(H, rec["id"])


# --- Test 2: next_run = today -> status paid
class TestTodayRecurrence:
    def test_today_creates_paid_and_appears_in_dashboard(self, H, today_info):
        t = today_info["today"]
        next_run = t

        before = _dashboard_expense(H)["expense"]
        amount = 9.99
        rec = _make_rec(H, next_run, "TEST_REC_TODAY", amount=amount)
        try:
            after = _dashboard_expense(H)["expense"]
            assert round(after - before, 2) == amount

            txs = requests.get(f"{API}/transactions", headers=H, timeout=30).json()
            matched = [x for x in txs if x.get("recurrence_id") == rec["id"]]
            assert len(matched) == 1
            tx = matched[0]
            assert tx["status"] == "paid"
            assert tx["date"] == next_run.isoformat()
            assert tx["notes"] == "(recorrente)"
        finally:
            _cleanup_rec_and_tx(H, rec["id"])


# --- Test 3: next_run no mês que vem -> NÃO gera lançamento ainda
class TestNextMonthRecurrence:
    def test_next_month_does_not_materialize_yet(self, H, today_info):
        t = today_info["today"]
        # primeiro dia do mês que vem
        if t.month == 12:
            next_run = date(t.year + 1, 1, min(t.day, 28))
        else:
            next_run = date(t.year, t.month + 1, min(t.day, 28))

        before = _dashboard_expense(H)["expense"]
        rec = _make_rec(H, next_run, "TEST_REC_NEXT_MONTH", amount=55.55)
        try:
            after = _dashboard_expense(H)["expense"]
            assert round(after - before, 2) == 0.0, (
                f"Recorrência do mês que vem NÃO devia somar em 'despesa do mês'. "
                f"before={before} after={after}"
            )
            txs = requests.get(f"{API}/transactions", headers=H, timeout=30).json()
            matched = [x for x in txs if x.get("recurrence_id") == rec["id"]]
            assert len(matched) == 0, (
                f"Não devia haver tx materializada ainda, achei {len(matched)}"
            )
            # next_run não avançou
            recs = requests.get(f"{API}/recurrences", headers=H, timeout=30).json()
            cur = next(x for x in recs if x["id"] == rec["id"])
            assert cur["next_run"] == next_run.isoformat()
        finally:
            _cleanup_rec_and_tx(H, rec["id"])


# --- Test 4: idempotência — múltiplas chamadas não duplicam
class TestIdempotency:
    def test_multiple_dashboard_and_tx_calls_do_not_duplicate(self, H, today_info):
        t = today_info["today"]
        last_day = today_info["last_day"]
        if t.day >= last_day:
            pytest.skip("Hoje é o último dia do mês; sem dia futuro para testar.")
        future_day = min(t.day + 1, last_day)
        next_run = date(t.year, t.month, future_day)

        amount = 7.77
        rec = _make_rec(H, next_run, "TEST_REC_IDEMPOTENT", amount=amount)
        try:
            # bombardear de chamadas
            for _ in range(5):
                requests.get(f"{API}/dashboard", headers=H, timeout=30)
                requests.get(f"{API}/transactions", headers=H, timeout=30)

            txs = requests.get(f"{API}/transactions", headers=H, timeout=30).json()
            matched = [x for x in txs if x.get("recurrence_id") == rec["id"]]
            assert len(matched) == 1, (
                f"Materialização duplicou! Esperava 1, achei {len(matched)}"
            )
        finally:
            _cleanup_rec_and_tx(H, rec["id"])
