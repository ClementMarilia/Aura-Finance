"""Wave 5 backend tests: month/year filter, account balances, transfers, recurrences, receipts."""
import io
import os
import time
from datetime import date, timedelta
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://analyze-code-20.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, pw="demo123"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def wendy():
    d = _login("wendy@demo.com")
    return {"token": d["token"], "user": d["user"], "h": {"Authorization": f"Bearer {d['token']}"}}


# ---------- Filter month/year ----------
def test_transactions_filter_month_year(wendy):
    h = wendy["h"]
    # create one tx in current month and one 6 months ago
    today = date.today()
    long_ago = (today.replace(day=1) - timedelta(days=200)).isoformat()
    cur_date = today.isoformat()

    accs = requests.get(f"{API}/accounts", headers=h).json()
    acc_id = accs[0]["id"]

    r1 = requests.post(f"{API}/transactions", headers=h, json={
        "type": "expense", "date": cur_date, "amount": 11.11,
        "account_id": acc_id, "description": "TEST_W5_current", "status": "paid",
    })
    assert r1.status_code == 200
    tid_cur = r1.json()["id"]

    r2 = requests.post(f"{API}/transactions", headers=h, json={
        "type": "expense", "date": long_ago, "amount": 22.22,
        "account_id": acc_id, "description": "TEST_W5_old", "status": "paid",
    })
    assert r2.status_code == 200
    tid_old = r2.json()["id"]

    # Filter to current month
    r = requests.get(f"{API}/transactions", headers=h, params={"year": today.year, "month": today.month})
    assert r.status_code == 200
    items = r.json()
    descs = [t.get("description") for t in items]
    assert "TEST_W5_current" in descs
    assert "TEST_W5_old" not in descs

    # cleanup
    requests.delete(f"{API}/transactions/{tid_cur}", headers=h)
    requests.delete(f"{API}/transactions/{tid_old}", headers=h)


# ---------- Account balance ----------
def test_account_balance_computed(wendy):
    h = wendy["h"]
    # create 2 fresh accounts
    a1 = requests.post(f"{API}/accounts", headers=h, json={"name": "TEST_W5_A1", "initial_balance": 100.0}).json()
    a2 = requests.post(f"{API}/accounts", headers=h, json={"name": "TEST_W5_A2", "initial_balance": 50.0}).json()
    today = date.today().isoformat()

    # +30 income on a1
    tx_inc = requests.post(f"{API}/transactions", headers=h, json={
        "type": "income", "date": today, "amount": 30.0,
        "account_id": a1["id"], "description": "TEST_W5_inc", "status": "paid",
    }).json()
    # -10 expense on a2
    tx_exp = requests.post(f"{API}/transactions", headers=h, json={
        "type": "expense", "date": today, "amount": 10.0,
        "account_id": a2["id"], "description": "TEST_W5_exp", "status": "paid",
    }).json()
    # transfer 20 from a1 -> a2
    tx_tr = requests.post(f"{API}/transactions", headers=h, json={
        "type": "transfer", "date": today, "amount": 20.0,
        "from_account_id": a1["id"], "to_account_id": a2["id"],
        "description": "TEST_W5_xfer", "status": "paid",
    }).json()

    accs = requests.get(f"{API}/accounts", headers=h).json()
    bal = {a["id"]: a["balance"] for a in accs if "balance" in a}
    # a1 = 100 + 30 - 20 = 110; a2 = 50 - 10 + 20 = 60
    assert bal[a1["id"]] == 110.0, f"a1 expected 110, got {bal[a1['id']]}"
    assert bal[a2["id"]] == 60.0, f"a2 expected 60, got {bal[a2['id']]}"

    for tid in [tx_inc["id"], tx_exp["id"], tx_tr["id"]]:
        requests.delete(f"{API}/transactions/{tid}", headers=h)


# ---------- Recurrences CRUD + materialization ----------
def test_recurrences_full_flow(wendy):
    h = wendy["h"]
    accs = requests.get(f"{API}/accounts", headers=h).json()
    acc_id = accs[0]["id"]

    # Create recurrence with next_run 2 months ago -> should materialize at least 2 txs
    past = (date.today().replace(day=1) - timedelta(days=70)).isoformat()
    r = requests.post(f"{API}/recurrences", headers=h, json={
        "type": "expense", "amount": 7.77, "account_id": acc_id,
        "description": "TEST_W5_REC", "frequency": "monthly",
        "next_run": past, "active": True,
    })
    assert r.status_code == 200, r.text
    rec = r.json()
    rid = rec["id"]

    # GET recurrences -> next_run should have advanced past today
    lst = requests.get(f"{API}/recurrences", headers=h).json()
    rfound = [x for x in lst if x["id"] == rid][0]
    assert rfound["next_run"] > date.today().isoformat() or rfound["next_run"] >= date.today().isoformat()

    # Check transactions were materialized (description matches)
    txs = requests.get(f"{API}/transactions", headers=h).json()
    mat = [t for t in txs if t.get("recurrence_id") == rid]
    assert len(mat) >= 2, f"expected >=2 materialized, got {len(mat)}"

    # Update
    upd = requests.put(f"{API}/recurrences/{rid}", headers=h, json={
        "type": "expense", "amount": 9.99, "description": "TEST_W5_REC_UPD",
        "frequency": "monthly", "next_run": rfound["next_run"], "active": True,
    })
    assert upd.status_code == 200
    assert upd.json()["amount"] == 9.99

    # Toggle
    tog = requests.post(f"{API}/recurrences/{rid}/toggle", headers=h)
    assert tog.status_code == 200
    assert tog.json()["active"] is False

    # Delete recurrence -- materialized txs should remain
    d = requests.delete(f"{API}/recurrences/{rid}", headers=h)
    assert d.status_code == 200
    txs_after = requests.get(f"{API}/transactions", headers=h).json()
    still = [t for t in txs_after if t.get("recurrence_id") == rid]
    assert len(still) >= 2, "materialized txs were unexpectedly removed"

    # cleanup the leftover materialized txs
    for t in still:
        requests.delete(f"{API}/transactions/{t['id']}", headers=h)


# ---------- Receipts upload/download/delete ----------
def test_receipts_flow(wendy):
    h = wendy["h"]
    token = wendy["token"]
    accs = requests.get(f"{API}/accounts", headers=h).json()
    acc_id = accs[0]["id"]
    today = date.today().isoformat()

    tx = requests.post(f"{API}/transactions", headers=h, json={
        "type": "expense", "date": today, "amount": 5.0,
        "account_id": acc_id, "description": "TEST_W5_RECEIPT", "status": "paid",
    }).json()
    tid = tx["id"]

    # 1x1 PNG
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d49444154789c63f8cf00000003000100186abcdc0000000049454e44ae426082"
    )
    files = {"file": ("test.png", io.BytesIO(png), "image/png")}
    up = requests.post(f"{API}/transactions/{tid}/receipt",
                       headers={"Authorization": h["Authorization"]}, files=files, timeout=60)
    assert up.status_code == 200, up.text
    receipt = up.json()
    assert "path" in receipt and "file_id" in receipt
    path = receipt["path"]

    # Download via Bearer
    dl = requests.get(f"{API}/files/{path}", headers=h, timeout=60)
    assert dl.status_code == 200
    assert dl.headers.get("content-type", "").startswith("image/png")
    assert len(dl.content) == len(png)

    # Download via ?auth=TOKEN query
    dl2 = requests.get(f"{API}/files/{path}", params={"auth": token}, timeout=60)
    assert dl2.status_code == 200
    assert len(dl2.content) == len(png)

    # Unauthenticated -> 401
    dl3 = requests.get(f"{API}/files/{path}")
    assert dl3.status_code == 401

    # Verify receipt on tx
    tlist = requests.get(f"{API}/transactions", headers=h).json()
    tdoc = [t for t in tlist if t["id"] == tid][0]
    assert tdoc.get("receipt", {}).get("path") == path

    # Delete (soft)
    rm = requests.delete(f"{API}/transactions/{tid}/receipt", headers=h)
    assert rm.status_code == 200

    # After delete, file 404 for download
    dl4 = requests.get(f"{API}/files/{path}", headers=h)
    assert dl4.status_code == 404

    # cleanup
    requests.delete(f"{API}/transactions/{tid}", headers=h)


def test_receipt_rejects_bad_type(wendy):
    h = wendy["h"]
    accs = requests.get(f"{API}/accounts", headers=h).json()
    acc_id = accs[0]["id"]
    today = date.today().isoformat()
    tx = requests.post(f"{API}/transactions", headers=h, json={
        "type": "expense", "date": today, "amount": 1.0,
        "account_id": acc_id, "description": "TEST_W5_BADTYPE", "status": "paid",
    }).json()
    tid = tx["id"]
    files = {"file": ("bad.exe", io.BytesIO(b"x" * 10), "application/octet-stream")}
    r = requests.post(f"{API}/transactions/{tid}/receipt",
                      headers={"Authorization": h["Authorization"]}, files=files, timeout=30)
    assert r.status_code == 400
    requests.delete(f"{API}/transactions/{tid}", headers=h)
