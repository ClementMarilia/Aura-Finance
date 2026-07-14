"""Backend tests for Controle Financeiro app."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://readme-generator-8.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, pw="demo123"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, f"login {email} {r.status_code} {r.text}"
    data = r.json()
    return data["token"], data["user"]


@pytest.fixture(scope="module")
def wendy():
    t, u = _login("wendy@demo.com")
    return {"token": t, "user": u, "h": {"Authorization": f"Bearer {t}"}}


@pytest.fixture(scope="module")
def marilia():
    t, u = _login("marilia@demo.com")
    return {"token": t, "user": u, "h": {"Authorization": f"Bearer {t}"}}


@pytest.fixture(scope="module")
def nathalia():
    t, u = _login("nathalia@demo.com")
    return {"token": t, "user": u, "h": {"Authorization": f"Bearer {t}"}}


# Auth
def test_login_invalid():
    r = requests.post(f"{API}/auth/login", json={"email": "wendy@demo.com", "password": "wrong"})
    assert r.status_code == 401

def test_me_requires_token():
    r = requests.get(f"{API}/auth/me")
    assert r.status_code == 401

def test_me_ok(wendy):
    r = requests.get(f"{API}/auth/me", headers=wendy["h"])
    assert r.status_code == 200
    assert r.json()["email"] == "wendy@demo.com"

def test_register_creates_user_with_defaults():
    em = f"test_{uuid.uuid4().hex[:8]}@demo.com"
    r = requests.post(f"{API}/auth/register", json={"name": "Tester", "email": em, "password": "pass123", "currency": "EUR"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and data["user"]["email"] == em
    h = {"Authorization": f"Bearer {data['token']}"}
    cats = requests.get(f"{API}/categories", headers=h).json()
    assert len(cats) >= 10
    accts = requests.get(f"{API}/accounts", headers=h).json()
    assert any(a["name"] == "Conta Principal" for a in accts)


# Dashboard
def test_dashboard(wendy):
    r = requests.get(f"{API}/dashboard", headers=wendy["h"])
    assert r.status_code == 200
    d = r.json()
    for k in ("income", "expense", "balance", "evolution", "category_breakdown", "budget"):
        assert k in d
    assert len(d["evolution"]) == 6
    assert len(d["budget"]["rules"]) == 5
    pcts = [r_["percent"] for r_ in d["budget"]["rules"]]
    assert pcts == [50, 20, 10, 10, 10]


# Transactions CRUD + privacy
def test_transactions_crud_and_privacy(wendy, marilia):
    payload = {"type": "expense", "date": "2026-01-15", "amount": 99.5, "description": "TEST_tx", "status": "paid"}
    r = requests.post(f"{API}/transactions", json=payload, headers=wendy["h"])
    assert r.status_code == 200
    tid = r.json()["id"]
    # filter list
    r2 = requests.get(f"{API}/transactions?type=expense", headers=wendy["h"])
    assert r2.status_code == 200
    assert any(t["id"] == tid for t in r2.json())
    # privacy
    r3 = requests.get(f"{API}/transactions", headers=marilia["h"])
    assert r3.status_code == 200
    assert not any(t["id"] == tid for t in r3.json())
    # delete
    rd = requests.delete(f"{API}/transactions/{tid}", headers=wendy["h"])
    assert rd.status_code == 200
    r4 = requests.get(f"{API}/transactions", headers=wendy["h"])
    assert not any(t["id"] == tid for t in r4.json())


# Installments
def test_installments_create_and_toggle(wendy):
    payload = {"description": "TEST_phone", "total_amount": 600, "installments": 3, "first_date": "2026-01-15"}
    r = requests.post(f"{API}/installments/purchases", json=payload, headers=wendy["h"])
    assert r.status_code == 200
    p = r.json()
    assert len(p["installments_list"]) == 3
    assert all(i["amount"] == 200.0 for i in p["installments_list"])
    assert all(i["status"] == "pending" for i in p["installments_list"])
    iid = p["installments_list"][0]["id"]
    r2 = requests.post(f"{API}/installments/{iid}/pay", headers=wendy["h"])
    assert r2.json()["status"] == "paid"
    r3 = requests.post(f"{API}/installments/{iid}/pay", headers=wendy["h"])
    assert r3.json()["status"] == "pending"
    requests.delete(f"{API}/installments/purchases/{p['id']}", headers=wendy["h"])


# Receivables
def test_receivables(wendy):
    payload = {"person": "TEST_John", "amount": 50, "due_date": "2026-02-01", "description": "TEST"}
    r = requests.post(f"{API}/receivables", json=payload, headers=wendy["h"])
    assert r.status_code == 200
    rid = r.json()["id"]
    assert r.json()["status"] == "pending"
    r2 = requests.post(f"{API}/receivables/{rid}/receive", headers=wendy["h"])
    assert r2.status_code == 200
    lst = requests.get(f"{API}/receivables", headers=wendy["h"]).json()
    rec = next(x for x in lst if x["id"] == rid)
    assert rec["status"] == "received"
    requests.delete(f"{API}/receivables/{rid}", headers=wendy["h"])


# Groups privacy
def test_groups_privacy_and_create(wendy):
    r = requests.get(f"{API}/groups", headers=wendy["h"])
    assert r.status_code == 200
    groups = r.json()
    assert any(g["name"] == "Casa" for g in groups)
    # create new
    r2 = requests.post(f"{API}/groups", json={"name": "TEST_g", "member_emails": []}, headers=wendy["h"])
    assert r2.status_code == 200
    assert wendy["user"]["id"] in r2.json()["member_ids"]
    requests.delete(f"{API}/groups/{r2.json()['id']}", headers=wendy["h"])


# Shared expenses
def test_shared_expenses_seed(wendy, marilia, nathalia):
    items = requests.get(f"{API}/shared-expenses", headers=wendy["h"]).json()
    mercado = next((x for x in items if x["title"] == "Mercado"), None)
    assert mercado is not None
    assert mercado["amount"] == 222.0
    assert mercado["payer_id"] == wendy["user"]["id"]
    assert len(mercado["participants"]) == 3
    for p in mercado["participants"]:
        assert p["owed"] == 74.0
    # marilia sees it too
    items_m = requests.get(f"{API}/shared-expenses", headers=marilia["h"]).json()
    assert any(x["title"] == "Mercado" for x in items_m)


def test_settlements_wendy_creditor(wendy, marilia):
    r = requests.get(f"{API}/settlements", headers=wendy["h"])
    assert r.status_code == 200
    d = r.json()
    # summary should have at least 2 entries with positive net (Marilia and Nathalia owe 74 each)
    nets = sorted([s["net"] for s in d["summary"]])
    assert 74.0 in nets
    assert sum(1 for n in nets if n == 74.0) >= 2

    r2 = requests.get(f"{API}/settlements", headers=marilia["h"])
    d2 = r2.json()
    nets2 = [s["net"] for s in d2["summary"]]
    assert -74.0 in nets2


def test_shared_expense_create_equal(wendy, marilia, nathalia):
    parts = [{"user_id": wendy["user"]["id"]},
             {"user_id": marilia["user"]["id"]},
             {"user_id": nathalia["user"]["id"]}]
    payload = {"title": "TEST_share", "amount": 90, "date": "2026-01-10", "category": "Outros",
               "payer_id": wendy["user"]["id"], "participants": parts, "split_type": "equal"}
    r = requests.post(f"{API}/shared-expenses", json=payload, headers=wendy["h"])
    assert r.status_code == 200, r.text
    d = r.json()
    assert all(p["owed"] == 30.0 for p in d["participants"])
    sid = d["id"]
    # settle marilia
    r2 = requests.post(f"{API}/shared-expenses/{sid}/settle/{marilia['user']['id']}", headers=wendy["h"])
    assert r2.json()["status"] in ("partial", "finalized")
    requests.delete(f"{API}/shared-expenses/{sid}", headers=wendy["h"])


def test_change_password_and_relogin():
    em = f"pw_{uuid.uuid4().hex[:8]}@demo.com"
    r = requests.post(f"{API}/auth/register", json={"name": "X", "email": em, "password": "old123"})
    assert r.status_code == 200
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    r2 = requests.post(f"{API}/auth/change-password", json={"current_password": "old123", "new_password": "new123"}, headers=h)
    assert r2.status_code == 200
    r3 = requests.post(f"{API}/auth/login", json={"email": em, "password": "new123"})
    assert r3.status_code == 200
    r4 = requests.post(f"{API}/auth/login", json={"email": em, "password": "old123"})
    assert r4.status_code == 401


# ============================================================================
# Onda 4 — YoY annual reports, projection, insights, goals CRUD
# ============================================================================

# Reports: annual (YoY)
def test_reports_annual_yoy_structure(wendy):
    r = requests.get(f"{API}/reports/annual?year=2026", headers=wendy["h"])
    assert r.status_code == 200, r.text
    d = r.json()
    # year/prev_year
    assert d["year"] == 2026
    assert d["prev_year"] == 2025
    # months arrays length 12
    assert isinstance(d["months"], list) and len(d["months"]) == 12
    assert isinstance(d["prev_months"], list) and len(d["prev_months"]) == 12
    # each month has expected keys
    for arr in (d["months"], d["prev_months"]):
        for m in arr:
            assert set(["month", "income", "expense", "balance"]).issubset(m.keys())
            assert 1 <= m["month"] <= 12
    # totals shape
    for key in ("totals", "prev_totals"):
        assert set(["income", "expense", "balance"]).issubset(d[key].keys())


# Reports: projection
def test_reports_projection_default_6(wendy):
    r = requests.get(f"{API}/reports/projection?months=6", headers=wendy["h"])
    assert r.status_code == 200, r.text
    d = r.json()
    assert "current_balance" in d
    assert "avg_monthly_net" in d
    assert isinstance(d["projection"], list)
    assert len(d["projection"]) == 6
    for p in d["projection"]:
        assert "month" in p and "projected" in p
        assert isinstance(p["projected"], (int, float))


def test_reports_projection_clamps_months(wendy):
    # months > 12 should be clamped to 12
    r = requests.get(f"{API}/reports/projection?months=99", headers=wendy["h"])
    assert r.status_code == 200
    assert len(r.json()["projection"]) == 12
    # months < 1 -> 1
    r2 = requests.get(f"{API}/reports/projection?months=0", headers=wendy["h"])
    assert r2.status_code == 200
    assert len(r2.json()["projection"]) == 1


# Insights
def test_insights_returns_list(wendy):
    r = requests.get(f"{API}/insights", headers=wendy["h"])
    assert r.status_code == 200, r.text
    arr = r.json()
    assert isinstance(arr, list) and len(arr) >= 1
    for it in arr:
        assert "title" in it and "message" in it and "severity" in it
        assert it["severity"] in ("good", "warning", "info")


# Goals CRUD
def test_goals_full_crud_and_contribute(wendy):
    h = wendy["h"]
    # Create
    payload = {"title": "TEST_Viagem", "target_amount": 1000.0, "current_amount": 100.0, "color": "#1E3F33"}
    c = requests.post(f"{API}/goals", json=payload, headers=h)
    assert c.status_code == 200, c.text
    created = c.json()
    assert created["title"] == "TEST_Viagem"
    assert created["target_amount"] == 1000.0
    assert created["current_amount"] == 100.0
    assert "id" in created
    gid = created["id"]

    # List
    lst = requests.get(f"{API}/goals", headers=h)
    assert lst.status_code == 200
    assert any(g["id"] == gid for g in lst.json())

    # Update
    upd_payload = {**payload, "title": "TEST_Viagem_Edit", "target_amount": 1500.0}
    u = requests.put(f"{API}/goals/{gid}", json=upd_payload, headers=h)
    assert u.status_code == 200
    assert u.json()["title"] == "TEST_Viagem_Edit"
    assert u.json()["target_amount"] == 1500.0

    # Contribute
    ct = requests.post(f"{API}/goals/{gid}/contribute", json={"amount": 250.0}, headers=h)
    assert ct.status_code == 200, ct.text
    assert ct.json()["current_amount"] == 350.0  # 100 + 250
    # Contribute again
    ct2 = requests.post(f"{API}/goals/{gid}/contribute", json={"amount": 50.0}, headers=h)
    assert ct2.status_code == 200
    assert ct2.json()["current_amount"] == 400.0

    # Verify persistence via list
    lst2 = requests.get(f"{API}/goals", headers=h).json()
    g_found = next((g for g in lst2 if g["id"] == gid), None)
    assert g_found is not None
    assert g_found["current_amount"] == 400.0

    # Delete
    d = requests.delete(f"{API}/goals/{gid}", headers=h)
    assert d.status_code == 200
    lst3 = requests.get(f"{API}/goals", headers=h).json()
    assert all(g["id"] != gid for g in lst3)


def test_goals_update_nonexistent_returns_404(wendy):
    r = requests.put(f"{API}/goals/does-not-exist",
                     json={"title": "x", "target_amount": 10, "current_amount": 0, "color": "#000"},
                     headers=wendy["h"])
    assert r.status_code == 404


def test_goals_contribute_nonexistent_returns_404(wendy):
    r = requests.post(f"{API}/goals/does-not-exist/contribute", json={"amount": 1}, headers=wendy["h"])
    assert r.status_code == 404


def test_goals_require_auth():
    assert requests.get(f"{API}/goals").status_code == 401
    assert requests.post(f"{API}/goals", json={"title": "x", "target_amount": 10}).status_code == 401


def test_reports_and_insights_require_auth():
    assert requests.get(f"{API}/reports/annual?year=2026").status_code == 401
    assert requests.get(f"{API}/reports/projection").status_code == 401
    assert requests.get(f"{API}/insights").status_code == 401
