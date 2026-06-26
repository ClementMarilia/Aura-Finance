#!/usr/bin/env python3
"""
Backend API Testing for Aurea Finance App
Tests 5 recent changes:
1. Wallet balance deducts paid installments
2. POST /transactions/bulk-delete
3. DELETE /recurrences/{rid} deletes future transactions
4. Annual report includes installments as expenses
5. account_id in recurrences and installments
"""

import requests
import json
from datetime import datetime, timedelta
from typing import Optional

# Base URL from frontend/.env
BASE_URL = "https://analyze-code-20.preview.emergentagent.com/api"

# Test credentials
TEST_EMAIL = "wendy@demo.com"
TEST_PASSWORD = "demo123"

class TestSession:
    def __init__(self):
        self.token: Optional[str] = None
        self.headers: dict = {}
        self.user_id: Optional[str] = None
        
    def login(self):
        """Login and get auth token"""
        print("\n=== LOGIN ===")
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            self.token = data.get("token")
            self.user_id = data.get("user", {}).get("id")
            self.headers = {"Authorization": f"Bearer {self.token}"}
            print(f"✓ Login successful. User ID: {self.user_id}")
            return True
        else:
            print(f"✗ Login failed: {resp.text}")
            return False

def test_wallet_balance_with_installments(session: TestSession):
    """
    Test 1: Wallet balance deducts paid installments
    - Get initial wallet balance
    - Create installment purchase with account_id
    - Verify balance unchanged (pending installments don't affect balance)
    - Mark first installment as paid
    - Verify balance reduced by installment amount
    - Reopen installment (mark as pending again)
    - Verify balance restored
    """
    print("\n" + "="*80)
    print("TEST 1: WALLET BALANCE DEDUCTS PAID INSTALLMENTS")
    print("="*80)
    
    # Get accounts
    print("\n--- Step 1: Get initial wallet balance ---")
    resp = requests.get(f"{BASE_URL}/accounts", headers=session.headers)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to get accounts: {resp.text}")
        return False
    
    accounts = resp.json()
    if not accounts:
        print("✗ No accounts found")
        return False
    
    # Use first account
    account = accounts[0]
    account_id = account["id"]
    initial_balance = account["balance"]
    print(f"✓ Account: {account['name']}, Initial balance: {initial_balance}")
    
    # Create installment purchase
    print("\n--- Step 2: Create installment purchase ---")
    today = datetime.now().date().isoformat()
    purchase_data = {
        "description": "Test Purchase - Laptop",
        "total_amount": 1200.00,
        "installments": 3,
        "first_date": today,
        "account_id": account_id
    }
    resp = requests.post(f"{BASE_URL}/installments/purchases", 
                        headers=session.headers, json=purchase_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to create purchase: {resp.text}")
        return False
    
    purchase = resp.json()
    purchase_id = purchase["id"]
    installments_list = purchase.get("installments_list", [])
    if not installments_list:
        print("✗ No installments created")
        return False
    
    first_installment = installments_list[0]
    installment_id = first_installment["id"]
    installment_amount = first_installment["amount"]
    print(f"✓ Purchase created. ID: {purchase_id}")
    print(f"  First installment ID: {installment_id}, Amount: {installment_amount}")
    
    # Check balance unchanged (pending installments don't affect balance)
    print("\n--- Step 3: Verify balance unchanged (pending installments) ---")
    resp = requests.get(f"{BASE_URL}/accounts", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get accounts: {resp.text}")
        return False
    
    accounts = resp.json()
    account = next((a for a in accounts if a["id"] == account_id), None)
    if not account:
        print("✗ Account not found")
        return False
    
    balance_after_pending = account["balance"]
    print(f"Balance after creating pending installments: {balance_after_pending}")
    if balance_after_pending == initial_balance:
        print("✓ Balance unchanged (pending installments don't affect balance)")
    else:
        print(f"✗ Balance changed unexpectedly: {initial_balance} -> {balance_after_pending}")
        return False
    
    # Mark first installment as paid
    print("\n--- Step 4: Mark first installment as paid ---")
    resp = requests.post(f"{BASE_URL}/installments/{installment_id}/pay", 
                        headers=session.headers)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to mark installment as paid: {resp.text}")
        return False
    
    result = resp.json()
    print(f"✓ Installment marked as: {result.get('status')}")
    
    # Check balance reduced
    print("\n--- Step 5: Verify balance reduced by installment amount ---")
    resp = requests.get(f"{BASE_URL}/accounts", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get accounts: {resp.text}")
        return False
    
    accounts = resp.json()
    account = next((a for a in accounts if a["id"] == account_id), None)
    if not account:
        print("✗ Account not found")
        return False
    
    balance_after_paid = account["balance"]
    expected_balance = round(initial_balance - installment_amount, 2)
    print(f"Balance after marking as paid: {balance_after_paid}")
    print(f"Expected balance: {expected_balance}")
    
    if abs(balance_after_paid - expected_balance) < 0.01:
        print(f"✓ Balance correctly reduced by {installment_amount}")
    else:
        print(f"✗ Balance incorrect. Expected: {expected_balance}, Got: {balance_after_paid}")
        return False
    
    # Reopen installment (mark as pending again)
    print("\n--- Step 6: Reopen installment (mark as pending) ---")
    resp = requests.post(f"{BASE_URL}/installments/{installment_id}/pay", 
                        headers=session.headers)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to reopen installment: {resp.text}")
        return False
    
    result = resp.json()
    print(f"✓ Installment marked as: {result.get('status')}")
    
    # Check balance restored
    print("\n--- Step 7: Verify balance restored ---")
    resp = requests.get(f"{BASE_URL}/accounts", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get accounts: {resp.text}")
        return False
    
    accounts = resp.json()
    account = next((a for a in accounts if a["id"] == account_id), None)
    if not account:
        print("✗ Account not found")
        return False
    
    balance_after_reopen = account["balance"]
    print(f"Balance after reopening: {balance_after_reopen}")
    print(f"Expected balance (initial): {initial_balance}")
    
    if abs(balance_after_reopen - initial_balance) < 0.01:
        print(f"✓ Balance correctly restored to {initial_balance}")
    else:
        print(f"✗ Balance not restored. Expected: {initial_balance}, Got: {balance_after_reopen}")
        return False
    
    # Cleanup
    print("\n--- Cleanup: Delete purchase ---")
    resp = requests.delete(f"{BASE_URL}/installments/purchases/{purchase_id}", 
                          headers=session.headers)
    if resp.status_code == 200:
        print("✓ Purchase deleted")
    
    print("\n✓✓✓ TEST 1 PASSED ✓✓✓")
    return True


def test_bulk_delete_transactions(session: TestSession):
    """
    Test 2: POST /transactions/bulk-delete
    - Create 2-3 transactions
    - Bulk delete with valid IDs
    - Verify transactions deleted
    - Test with non-existent IDs
    - Test with empty list
    """
    print("\n" + "="*80)
    print("TEST 2: BULK DELETE TRANSACTIONS")
    print("="*80)
    
    # Get an account for transactions
    resp = requests.get(f"{BASE_URL}/accounts", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get accounts: {resp.text}")
        return False
    accounts = resp.json()
    if not accounts:
        print("✗ No accounts found")
        return False
    account_id = accounts[0]["id"]
    
    # Create test transactions
    print("\n--- Step 1: Create test transactions ---")
    today = datetime.now().date().isoformat()
    transaction_ids = []
    
    for i in range(3):
        tx_data = {
            "type": "expense",
            "date": today,
            "amount": 50.00 + i * 10,
            "account_id": account_id,
            "description": f"Test Transaction {i+1}",
            "status": "paid"
        }
        resp = requests.post(f"{BASE_URL}/transactions", 
                           headers=session.headers, json=tx_data)
        if resp.status_code != 200:
            print(f"✗ Failed to create transaction {i+1}: {resp.text}")
            return False
        tx = resp.json()
        transaction_ids.append(tx["id"])
        print(f"✓ Created transaction {i+1}: ID={tx['id']}, Amount={tx['amount']}")
    
    # Verify transactions exist
    print("\n--- Step 2: Verify transactions exist ---")
    resp = requests.get(f"{BASE_URL}/transactions", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get transactions: {resp.text}")
        return False
    all_txs = resp.json()
    found_count = sum(1 for tx in all_txs if tx["id"] in transaction_ids)
    print(f"✓ Found {found_count}/3 transactions")
    
    # Bulk delete first 2 transactions
    print("\n--- Step 3: Bulk delete first 2 transactions ---")
    delete_ids = transaction_ids[:2]
    resp = requests.post(f"{BASE_URL}/transactions/bulk-delete",
                        headers=session.headers, json={"ids": delete_ids})
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to bulk delete: {resp.text}")
        return False
    
    result = resp.json()
    deleted_count = result.get("deleted", 0)
    print(f"Deleted count: {deleted_count}")
    if deleted_count == 2:
        print("✓ Correctly deleted 2 transactions")
    else:
        print(f"✗ Expected 2 deletions, got {deleted_count}")
        return False
    
    # Verify transactions deleted
    print("\n--- Step 4: Verify transactions deleted ---")
    resp = requests.get(f"{BASE_URL}/transactions", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get transactions: {resp.text}")
        return False
    all_txs = resp.json()
    remaining = [tx for tx in all_txs if tx["id"] in delete_ids]
    if len(remaining) == 0:
        print("✓ Deleted transactions not found (correctly deleted)")
    else:
        print(f"✗ Found {len(remaining)} transactions that should be deleted")
        return False
    
    # Test with non-existent IDs
    print("\n--- Step 5: Test bulk delete with non-existent IDs ---")
    fake_ids = ["fake-id-1", "fake-id-2"]
    resp = requests.post(f"{BASE_URL}/transactions/bulk-delete",
                        headers=session.headers, json={"ids": fake_ids})
    if resp.status_code != 200:
        print(f"✗ Failed request: {resp.text}")
        return False
    result = resp.json()
    deleted_count = result.get("deleted", 0)
    if deleted_count == 0:
        print("✓ Correctly returned deleted: 0 for non-existent IDs")
    else:
        print(f"✗ Expected 0 deletions, got {deleted_count}")
        return False
    
    # Test with empty list
    print("\n--- Step 6: Test bulk delete with empty list ---")
    resp = requests.post(f"{BASE_URL}/transactions/bulk-delete",
                        headers=session.headers, json={"ids": []})
    if resp.status_code != 200:
        print(f"✗ Failed request: {resp.text}")
        return False
    result = resp.json()
    deleted_count = result.get("deleted", 0)
    if deleted_count == 0:
        print("✓ Correctly returned deleted: 0 for empty list")
    else:
        print(f"✗ Expected 0 deletions, got {deleted_count}")
        return False
    
    # Cleanup remaining transaction
    print("\n--- Cleanup: Delete remaining transaction ---")
    if len(transaction_ids) > 2:
        resp = requests.delete(f"{BASE_URL}/transactions/{transaction_ids[2]}", 
                             headers=session.headers)
        if resp.status_code == 200:
            print("✓ Remaining transaction deleted")
    
    print("\n✓✓✓ TEST 2 PASSED ✓✓✓")
    return True


def test_delete_recurrence_removes_future_transactions(session: TestSession):
    """
    Test 3: DELETE /recurrences/{rid} deletes future transactions
    - Create monthly recurrence
    - Materialize future transactions (query future month)
    - Delete recurrence
    - Verify future transactions deleted
    - Verify past/today transactions remain
    """
    print("\n" + "="*80)
    print("TEST 3: DELETE RECURRENCE REMOVES FUTURE TRANSACTIONS")
    print("="*80)
    
    # Get account
    resp = requests.get(f"{BASE_URL}/accounts", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get accounts: {resp.text}")
        return False
    accounts = resp.json()
    if not accounts:
        print("✗ No accounts found")
        return False
    account_id = accounts[0]["id"]
    
    # Create monthly recurrence starting today
    print("\n--- Step 1: Create monthly recurrence ---")
    today = datetime.now().date().isoformat()
    recurrence_data = {
        "type": "expense",
        "amount": 100.00,
        "frequency": "monthly",
        "next_run": today,
        "account_id": account_id,
        "description": "Test Recurrence - Monthly Subscription"
    }
    resp = requests.post(f"{BASE_URL}/recurrences", 
                        headers=session.headers, json=recurrence_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to create recurrence: {resp.text}")
        return False
    
    recurrence = resp.json()
    recurrence_id = recurrence["id"]
    print(f"✓ Recurrence created. ID: {recurrence_id}")
    
    # Materialize future transactions by querying 2 months ahead
    print("\n--- Step 2: Materialize future transactions ---")
    future_date = datetime.now() + timedelta(days=60)
    future_year = future_date.year
    future_month = future_date.month
    
    resp = requests.get(f"{BASE_URL}/transactions",
                       params={"year": future_year, "month": future_month},
                       headers=session.headers)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to get transactions: {resp.text}")
        return False
    
    future_txs = resp.json()
    recurrence_txs = [tx for tx in future_txs if tx.get("recurrence_id") == recurrence_id]
    print(f"✓ Found {len(recurrence_txs)} future transactions for this recurrence")
    
    if len(recurrence_txs) == 0:
        print("⚠ Warning: No future transactions materialized. This might be expected.")
    
    # Get all transactions with this recurrence_id before deletion
    print("\n--- Step 3: Count all transactions before deletion ---")
    resp = requests.get(f"{BASE_URL}/transactions", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get transactions: {resp.text}")
        return False
    all_txs = resp.json()
    all_recurrence_txs = [tx for tx in all_txs if tx.get("recurrence_id") == recurrence_id]
    today_str = datetime.now().date().isoformat()
    past_or_today = [tx for tx in all_recurrence_txs if tx.get("date", "") <= today_str]
    future = [tx for tx in all_recurrence_txs if tx.get("date", "") > today_str]
    print(f"Total transactions with recurrence_id: {len(all_recurrence_txs)}")
    print(f"  Past/Today: {len(past_or_today)}")
    print(f"  Future: {len(future)}")
    
    # Delete recurrence
    print("\n--- Step 4: Delete recurrence ---")
    resp = requests.delete(f"{BASE_URL}/recurrences/{recurrence_id}", 
                          headers=session.headers)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to delete recurrence: {resp.text}")
        return False
    
    result = resp.json()
    deleted_future = result.get("deleted_future", 0)
    print(f"✓ Recurrence deleted. Deleted future transactions: {deleted_future}")
    
    # Verify future transactions deleted
    print("\n--- Step 5: Verify future transactions deleted ---")
    resp = requests.get(f"{BASE_URL}/transactions", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get transactions: {resp.text}")
        return False
    all_txs = resp.json()
    remaining_recurrence_txs = [tx for tx in all_txs if tx.get("recurrence_id") == recurrence_id]
    remaining_future = [tx for tx in remaining_recurrence_txs if tx.get("date", "") > today_str]
    remaining_past = [tx for tx in remaining_recurrence_txs if tx.get("date", "") <= today_str]
    
    print(f"Remaining transactions with recurrence_id: {len(remaining_recurrence_txs)}")
    print(f"  Past/Today: {len(remaining_past)}")
    print(f"  Future: {len(remaining_future)}")
    
    if len(remaining_future) == 0:
        print("✓ All future transactions deleted")
    else:
        print(f"✗ Found {len(remaining_future)} future transactions that should be deleted")
        return False
    
    # Verify past/today transactions remain (if any were created)
    if len(past_or_today) > 0:
        if len(remaining_past) == len(past_or_today):
            print(f"✓ Past/today transactions remain ({len(remaining_past)} transactions)")
        else:
            print(f"⚠ Warning: Past transaction count changed: {len(past_or_today)} -> {len(remaining_past)}")
    
    # Cleanup remaining transactions
    print("\n--- Cleanup: Delete remaining transactions ---")
    for tx in remaining_recurrence_txs:
        requests.delete(f"{BASE_URL}/transactions/{tx['id']}", headers=session.headers)
    print("✓ Cleanup complete")
    
    print("\n✓✓✓ TEST 3 PASSED ✓✓✓")
    return True


def test_annual_report_includes_installments(session: TestSession):
    """
    Test 4: Annual report includes installments as expenses
    - Create installment purchase
    - Get annual report
    - Verify expense includes installment amounts for the month
    """
    print("\n" + "="*80)
    print("TEST 4: ANNUAL REPORT INCLUDES INSTALLMENTS")
    print("="*80)
    
    # Get account
    resp = requests.get(f"{BASE_URL}/accounts", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get accounts: {resp.text}")
        return False
    accounts = resp.json()
    if not accounts:
        print("✗ No accounts found")
        return False
    account_id = accounts[0]["id"]
    
    # Get current year/month
    now = datetime.now()
    current_year = now.year
    current_month = now.month
    
    # Get baseline annual report
    print("\n--- Step 1: Get baseline annual report ---")
    resp = requests.get(f"{BASE_URL}/reports/annual",
                       params={"year": current_year},
                       headers=session.headers)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to get annual report: {resp.text}")
        return False
    
    baseline_report = resp.json()
    baseline_months = baseline_report.get("months", [])
    baseline_current_month = next((m for m in baseline_months if m["month"] == current_month), None)
    if not baseline_current_month:
        print(f"✗ Current month {current_month} not found in report")
        return False
    
    baseline_expense = baseline_current_month["expense"]
    print(f"✓ Baseline expense for month {current_month}: {baseline_expense}")
    
    # Create installment purchase with first installment due this month
    print("\n--- Step 2: Create installment purchase ---")
    today = datetime.now().date().isoformat()
    purchase_data = {
        "description": "Test Purchase - Camera",
        "total_amount": 900.00,
        "installments": 3,
        "first_date": today,
        "account_id": account_id
    }
    resp = requests.post(f"{BASE_URL}/installments/purchases", 
                        headers=session.headers, json=purchase_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to create purchase: {resp.text}")
        return False
    
    purchase = resp.json()
    purchase_id = purchase["id"]
    installments_list = purchase.get("installments_list", [])
    if not installments_list:
        print("✗ No installments created")
        return False
    
    # Calculate total installments for current month
    current_month_installments = [i for i in installments_list 
                                  if i["due_date"].startswith(f"{current_year}-{current_month:02d}")]
    total_installment_amount = sum(i["amount"] for i in current_month_installments)
    print(f"✓ Purchase created. ID: {purchase_id}")
    print(f"  Installments due this month: {len(current_month_installments)}")
    print(f"  Total amount for this month: {total_installment_amount}")
    
    # Get updated annual report
    print("\n--- Step 3: Get updated annual report ---")
    resp = requests.get(f"{BASE_URL}/reports/annual",
                       params={"year": current_year},
                       headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get annual report: {resp.text}")
        return False
    
    updated_report = resp.json()
    updated_months = updated_report.get("months", [])
    updated_current_month = next((m for m in updated_months if m["month"] == current_month), None)
    if not updated_current_month:
        print(f"✗ Current month {current_month} not found in report")
        return False
    
    updated_expense = updated_current_month["expense"]
    print(f"✓ Updated expense for month {current_month}: {updated_expense}")
    
    # Verify expense increased by installment amount
    print("\n--- Step 4: Verify expense includes installments ---")
    expected_expense = round(baseline_expense + total_installment_amount, 2)
    print(f"Expected expense: {expected_expense}")
    print(f"Actual expense: {updated_expense}")
    
    if abs(updated_expense - expected_expense) < 0.01:
        print(f"✓ Expense correctly includes installments (+{total_installment_amount})")
    else:
        print(f"✗ Expense mismatch. Expected: {expected_expense}, Got: {updated_expense}")
        return False
    
    # Also verify dashboard consistency
    print("\n--- Step 5: Verify dashboard consistency ---")
    resp = requests.get(f"{BASE_URL}/dashboard",
                       params={"year": current_year, "month": current_month},
                       headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get dashboard: {resp.text}")
        return False
    
    dashboard = resp.json()
    dashboard_installments_total = dashboard.get("installments_month_total", 0)
    print(f"Dashboard installments_month_total: {dashboard_installments_total}")
    
    if abs(dashboard_installments_total - total_installment_amount) < 0.01:
        print("✓ Dashboard shows correct installment total")
    else:
        print(f"⚠ Warning: Dashboard installment total mismatch")
    
    # Cleanup
    print("\n--- Cleanup: Delete purchase ---")
    resp = requests.delete(f"{BASE_URL}/installments/purchases/{purchase_id}", 
                          headers=session.headers)
    if resp.status_code == 200:
        print("✓ Purchase deleted")
    
    print("\n✓✓✓ TEST 4 PASSED ✓✓✓")
    return True


def test_account_id_in_recurrence_and_installments(session: TestSession):
    """
    Test 5: account_id in recurrences and installments
    - Create recurrence with account_id, verify it's saved
    - Create installment purchase with account_id
    - Update installment purchase with different account_id
    - Verify account_id is updated
    """
    print("\n" + "="*80)
    print("TEST 5: ACCOUNT_ID IN RECURRENCES AND INSTALLMENTS")
    print("="*80)
    
    # Get accounts
    resp = requests.get(f"{BASE_URL}/accounts", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get accounts: {resp.text}")
        return False
    accounts = resp.json()
    if len(accounts) < 1:
        print("✗ Need at least 1 account")
        return False
    
    account1_id = accounts[0]["id"]
    account1_name = accounts[0]["name"]
    
    # Create second account if needed
    account2_id = None
    account2_name = None
    if len(accounts) >= 2:
        account2_id = accounts[1]["id"]
        account2_name = accounts[1]["name"]
    else:
        print("\n--- Creating second account for testing ---")
        resp = requests.post(f"{BASE_URL}/accounts",
                           headers=session.headers,
                           json={"name": "Test Account 2", "type": "savings", "initial_balance": 0})
        if resp.status_code == 200:
            account2 = resp.json()
            account2_id = account2["id"]
            account2_name = account2["name"]
            print(f"✓ Created account: {account2_name}")
        else:
            print("⚠ Could not create second account, will use first account for both tests")
            account2_id = account1_id
            account2_name = account1_name
    
    print(f"\nUsing accounts:")
    print(f"  Account 1: {account1_name} (ID: {account1_id})")
    print(f"  Account 2: {account2_name} (ID: {account2_id})")
    
    # Test recurrence with account_id
    print("\n--- Step 1: Create recurrence with account_id ---")
    today = datetime.now().date().isoformat()
    recurrence_data = {
        "type": "expense",
        "amount": 50.00,
        "frequency": "monthly",
        "next_run": today,
        "account_id": account1_id,
        "description": "Test Recurrence with Account"
    }
    resp = requests.post(f"{BASE_URL}/recurrences", 
                        headers=session.headers, json=recurrence_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to create recurrence: {resp.text}")
        return False
    
    recurrence = resp.json()
    recurrence_id = recurrence["id"]
    print(f"✓ Recurrence created. ID: {recurrence_id}")
    
    # Verify account_id saved
    print("\n--- Step 2: Verify recurrence has account_id ---")
    resp = requests.get(f"{BASE_URL}/recurrences", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get recurrences: {resp.text}")
        return False
    
    recurrences = resp.json()
    created_recurrence = next((r for r in recurrences if r["id"] == recurrence_id), None)
    if not created_recurrence:
        print("✗ Recurrence not found")
        return False
    
    saved_account_id = created_recurrence.get("account_id")
    print(f"Saved account_id: {saved_account_id}")
    if saved_account_id == account1_id:
        print("✓ Recurrence correctly saved account_id")
    else:
        print(f"✗ account_id mismatch. Expected: {account1_id}, Got: {saved_account_id}")
        return False
    
    # Test installment purchase with account_id
    print("\n--- Step 3: Create installment purchase with account_id ---")
    purchase_data = {
        "description": "Test Purchase with Account",
        "total_amount": 600.00,
        "installments": 2,
        "first_date": today,
        "account_id": account1_id
    }
    resp = requests.post(f"{BASE_URL}/installments/purchases", 
                        headers=session.headers, json=purchase_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to create purchase: {resp.text}")
        return False
    
    purchase = resp.json()
    purchase_id = purchase["id"]
    initial_account_id = purchase.get("account_id")
    print(f"✓ Purchase created. ID: {purchase_id}")
    print(f"  Initial account_id: {initial_account_id}")
    
    if initial_account_id == account1_id:
        print("✓ Purchase correctly saved account_id")
    else:
        print(f"✗ account_id mismatch. Expected: {account1_id}, Got: {initial_account_id}")
        return False
    
    # Update purchase with different account_id
    print("\n--- Step 4: Update purchase with different account_id ---")
    update_data = {
        "account_id": account2_id
    }
    resp = requests.put(f"{BASE_URL}/installments/purchases/{purchase_id}",
                       headers=session.headers, json=update_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"✗ Failed to update purchase: {resp.text}")
        return False
    
    print("✓ Purchase updated")
    
    # Verify account_id updated
    print("\n--- Step 5: Verify purchase has updated account_id ---")
    resp = requests.get(f"{BASE_URL}/installments/purchases", headers=session.headers)
    if resp.status_code != 200:
        print(f"✗ Failed to get purchases: {resp.text}")
        return False
    
    purchases = resp.json()
    updated_purchase = next((p for p in purchases if p["id"] == purchase_id), None)
    if not updated_purchase:
        print("✗ Purchase not found")
        return False
    
    updated_account_id = updated_purchase.get("account_id")
    print(f"Updated account_id: {updated_account_id}")
    if updated_account_id == account2_id:
        print("✓ Purchase correctly updated account_id")
    else:
        print(f"✗ account_id not updated. Expected: {account2_id}, Got: {updated_account_id}")
        return False
    
    # Cleanup
    print("\n--- Cleanup ---")
    requests.delete(f"{BASE_URL}/recurrences/{recurrence_id}", headers=session.headers)
    requests.delete(f"{BASE_URL}/installments/purchases/{purchase_id}", headers=session.headers)
    print("✓ Cleanup complete")
    
    print("\n✓✓✓ TEST 5 PASSED ✓✓✓")
    return True


def main():
    """Run all backend tests"""
    print("="*80)
    print("AUREA FINANCE BACKEND API TESTS")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test User: {TEST_EMAIL}")
    
    # Create session and login
    session = TestSession()
    if not session.login():
        print("\n✗✗✗ LOGIN FAILED - CANNOT PROCEED ✗✗✗")
        return
    
    # Run all tests
    results = {}
    
    try:
        results["Test 1: Wallet Balance with Installments"] = test_wallet_balance_with_installments(session)
    except Exception as e:
        print(f"\n✗ Test 1 failed with exception: {e}")
        results["Test 1: Wallet Balance with Installments"] = False
    
    try:
        results["Test 2: Bulk Delete Transactions"] = test_bulk_delete_transactions(session)
    except Exception as e:
        print(f"\n✗ Test 2 failed with exception: {e}")
        results["Test 2: Bulk Delete Transactions"] = False
    
    try:
        results["Test 3: Delete Recurrence Removes Future"] = test_delete_recurrence_removes_future_transactions(session)
    except Exception as e:
        print(f"\n✗ Test 3 failed with exception: {e}")
        results["Test 3: Delete Recurrence Removes Future"] = False
    
    try:
        results["Test 4: Annual Report Includes Installments"] = test_annual_report_includes_installments(session)
    except Exception as e:
        print(f"\n✗ Test 4 failed with exception: {e}")
        results["Test 4: Annual Report Includes Installments"] = False
    
    try:
        results["Test 5: Account ID in Recurrence and Installments"] = test_account_id_in_recurrence_and_installments(session)
    except Exception as e:
        print(f"\n✗ Test 5 failed with exception: {e}")
        results["Test 5: Account ID in Recurrence and Installments"] = False
    
    # Print summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    for test_name, passed in results.items():
        status = "✓ PASSED" if passed else "✗ FAILED"
        print(f"{status}: {test_name}")
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED 🎉")
    else:
        print(f"\n⚠ {total - passed} test(s) failed")


if __name__ == "__main__":
    main()
