"""Backend tests for Wave 8: Wallets CRUD + balance updates from transactions, Budget per month/year.

Covers:
- POST/PUT/DELETE /accounts (wallets) with new types (savings, investment...)
- GET /accounts returns computed `balance` reflecting initial_balance +- transactions
- GET /dashboard?year&month returns budget for future months (income 0 when no data)
- Wallet used to pay an expense decreases balance correctly
"""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": "wendy@demo.com", "password": "demo123"})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def created(session):
    """Tracks IDs to clean up after the module."""
    state = {"accounts": [], "transactions": []}
    yield state
    # Teardown
    for tid in state["transactions"]:
        try:
            session.delete(f"{API}/transactions/{tid}")
        except Exception:
            pass
    for aid in state["accounts"]:
        try:
            session.delete(f"{API}/accounts/{aid}")
        except Exception:
            pass


class TestWalletsCRUD:
    def test_create_savings_wallet_with_balance(self, session, created):
        payload = {"name": "TEST_Poupanca", "type": "savings", "initial_balance": 5000.0}
        r = session.post(f"{API}/accounts", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_Poupanca"
        assert data["type"] == "savings"
        assert data["initial_balance"] == 5000.0
        assert "id" in data
        assert "_id" not in data
        created["accounts"].append(data["id"])

    def test_list_accounts_includes_balance(self, session, created):
        r = session.get(f"{API}/accounts")
        assert r.status_code == 200
        accounts = r.json()
        ids = [a["id"] for a in accounts]
        assert created["accounts"][0] in ids
        wallet = next(a for a in accounts if a["id"] == created["accounts"][0])
        assert wallet["balance"] == 5000.0
        # _id should not leak
        for a in accounts:
            assert "_id" not in a

    def test_edit_wallet_balance_and_type_investment(self, session, created):
        aid = created["accounts"][0]
        payload = {"name": "TEST_Investimento", "type": "investment", "initial_balance": 5200.0}
        r = session.put(f"{API}/accounts/{aid}", json=payload)
        assert r.status_code == 200, r.text
        # GET to verify persistence
        r = session.get(f"{API}/accounts")
        a = next(x for x in r.json() if x["id"] == aid)
        assert a["name"] == "TEST_Investimento"
        assert a["type"] == "investment"
        assert a["balance"] == 5200.0

    def test_wallet_used_to_pay_expense_decreases_balance(self, session, created):
        aid = created["accounts"][0]
        tx = {
            "type": "expense", "date": "2026-06-25", "amount": 200.0,
            "account_id": aid, "description": "TEST_DBG_Pagamento", "status": "paid",
        }
        r = session.post(f"{API}/transactions", json=tx)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        created["transactions"].append(tid)
        # 5200 - 200 = 5000
        r = session.get(f"{API}/accounts")
        a = next(x for x in r.json() if x["id"] == aid)
        assert a["balance"] == 5000.0, f"expected 5000 got {a['balance']}"

    def test_income_increases_balance(self, session, created):
        aid = created["accounts"][0]
        tx = {
            "type": "income", "date": "2026-06-25", "amount": 50.0,
            "account_id": aid, "description": "TEST_DBG_Receita", "status": "paid",
        }
        r = session.post(f"{API}/transactions", json=tx)
        assert r.status_code == 200
        created["transactions"].append(r.json()["id"])
        r = session.get(f"{API}/accounts")
        a = next(x for x in r.json() if x["id"] == aid)
        assert a["balance"] == 5050.0

    def test_delete_wallet(self, session, created):
        # Create a temp wallet to delete cleanly
        r = session.post(f"{API}/accounts", json={"name": "TEST_ToDelete", "type": "cash", "initial_balance": 100.0})
        assert r.status_code == 200
        aid = r.json()["id"]
        r = session.delete(f"{API}/accounts/{aid}")
        assert r.status_code == 200
        # Verify gone
        r = session.get(f"{API}/accounts")
        ids = [a["id"] for a in r.json()]
        assert aid not in ids


class TestBudgetByMonth:
    def test_budget_current_month(self, session):
        r = session.get(f"{API}/dashboard", params={"year": 2026, "month": 6})
        assert r.status_code == 200
        data = r.json()
        assert "budget" in data
        assert "income" in data["budget"]
        assert "rules" in data["budget"]
        assert len(data["budget"]["rules"]) == 5

    def test_budget_future_month_zero_income_ok(self, session):
        # Far future month should not 500
        r = session.get(f"{API}/dashboard", params={"year": 2030, "month": 12})
        assert r.status_code == 200
        data = r.json()
        assert "budget" in data
        # No recurrences in 2030 → income should be 0
        assert data["budget"]["income"] == 0
        # 5 rules even with zero income
        assert len(data["budget"]["rules"]) == 5
        for rule in data["budget"]["rules"]:
            assert rule["amount"] == 0

    def test_budget_distinct_months_different_income(self, session, created):
        """Create an income in July 2026 and verify it shows in July but not in August."""
        if not created["accounts"]:
            pytest.skip("no account from previous tests")
        aid = created["accounts"][0]
        tx = {
            "type": "income", "date": "2026-07-10", "amount": 3000.0,
            "account_id": aid, "description": "TEST_DBG_SalarioJul", "status": "paid",
        }
        r = session.post(f"{API}/transactions", json=tx)
        assert r.status_code == 200
        created["transactions"].append(r.json()["id"])

        r_jul = session.get(f"{API}/dashboard", params={"year": 2026, "month": 7})
        r_aug = session.get(f"{API}/dashboard", params={"year": 2026, "month": 8})
        assert r_jul.status_code == 200
        assert r_aug.status_code == 200
        jul = r_jul.json()["budget"]["income"]
        aug = r_aug.json()["budget"]["income"]
        assert jul >= 3000.0
        # August shouldn't have this one-off income
        assert aug < jul
