"""Backend tests for Controle Financeiro app."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://despesa-facil-2.preview.emergentagent.com").rstrip("/")
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
