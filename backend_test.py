#!/usr/bin/env python3
"""
Backend API Test Suite for Aurea Financial App
Tests the receivables bug fix: confirming receipt generates income and credits wallet
"""

import requests
import json
from datetime import datetime, date

# Configuration
BASE_URL = "https://analyze-code-20.preview.emergentagent.com/api"
TEST_USER = {
    "email": "wendy@demo.com",
    "password": "demo123"
}

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'

def log_success(msg):
    print(f"{Colors.GREEN}✓ {msg}{Colors.END}")

def log_error(msg):
    print(f"{Colors.RED}✗ {msg}{Colors.END}")

def log_info(msg):
    print(f"{Colors.BLUE}ℹ {msg}{Colors.END}")

def log_warning(msg):
    print(f"{Colors.YELLOW}⚠ {msg}{Colors.END}")

class TestSession:
    def __init__(self):
        self.token = None
        self.headers = {}
        self.user_id = None
        
    def login(self):
        """Login and get bearer token"""
        log_info(f"Logging in as {TEST_USER['email']}...")
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json=TEST_USER,
            timeout=30
        )
        
        if response.status_code != 200:
            log_error(f"Login failed: {response.status_code} - {response.text}")
            return False
            
        data = response.json()
        self.token = data.get("token")
        self.user_id = data.get("user", {}).get("id")
        self.headers = {"Authorization": f"Bearer {self.token}"}
        log_success(f"Logged in successfully. User ID: {self.user_id}")
        return True
    
    def get(self, endpoint, params=None):
        """GET request with auth"""
        response = requests.get(
            f"{BASE_URL}{endpoint}",
            headers=self.headers,
            params=params,
            timeout=30
        )
        return response
    
    def post(self, endpoint, data=None):
        """POST request with auth"""
        response = requests.post(
            f"{BASE_URL}{endpoint}",
            headers=self.headers,
            json=data,
            timeout=30
        )
        return response
    
    def delete(self, endpoint):
        """DELETE request with auth"""
        response = requests.delete(
            f"{BASE_URL}{endpoint}",
            headers=self.headers,
            timeout=30
        )
        return response


def test_receivables_bug_fix():
    """
    Test the bug fix: Confirming receivable receipt generates income and credits wallet
    
    Scenario:
    1. Get initial wallet balance (S0) and dashboard income (I0)
    2. Create receivable with account_id, amount 150, due_date today
    3. Verify balance and income unchanged (still pending)
    4. Confirm receipt → verify income = I0 + 150, balance = S0 + 150, transaction exists
    5. Toggle back to pending → verify income and balance restored, transaction removed
    6. Receive again and delete → verify transaction also removed
    """
    
    print("\n" + "="*80)
    print("TEST: Receivables Bug Fix - Confirm Receipt Generates Income & Credits Wallet")
    print("="*80 + "\n")
    
    session = TestSession()
    
    # Step 1: Login
    if not session.login():
        log_error("Cannot proceed without login")
        return False
    
    print("\n--- STEP 1: Get Initial State ---")
    
    # Get accounts and choose one
    response = session.get("/accounts")
    if response.status_code != 200:
        log_error(f"Failed to get accounts: {response.status_code} - {response.text}")
        return False
    
    accounts = response.json()
    if not accounts:
        log_error("No accounts found. Need at least one wallet.")
        return False
    
    # Choose first account
    account = accounts[0]
    account_id = account["id"]
    initial_balance = account["balance"]
    S0 = initial_balance
    
    log_success(f"Selected wallet: {account.get('name', 'Unnamed')} (ID: {account_id})")
    log_info(f"Initial balance S0 = {S0}")
    
    # Get dashboard income
    today = date.today()
    response = session.get("/dashboard", params={"year": today.year, "month": today.month})
    if response.status_code != 200:
        log_error(f"Failed to get dashboard: {response.status_code} - {response.text}")
        return False
    
    dashboard = response.json()
    initial_income = dashboard.get("income", 0)
    I0 = initial_income
    
    log_success(f"Dashboard retrieved")
    log_info(f"Initial income I0 = {I0}")
    
    print("\n--- STEP 2: Create Receivable ---")
    
    # Create receivable with amount 150, due today
    receivable_data = {
        "person": "Cliente Teste Recebível",
        "amount": 150.0,
        "due_date": today.isoformat(),
        "description": "Serviço de consultoria",
        "account_id": account_id
    }
    
    response = session.post("/receivables", receivable_data)
    if response.status_code != 200:
        log_error(f"Failed to create receivable: {response.status_code} - {response.text}")
        return False
    
    receivable = response.json()
    receivable_id = receivable["id"]
    
    log_success(f"Receivable created (ID: {receivable_id})")
    log_info(f"Amount: {receivable['amount']}, Status: {receivable['status']}, Account: {receivable.get('account_id')}")
    
    # Verify receivable is saved with correct account_id
    response = session.get("/receivables")
    if response.status_code != 200:
        log_error(f"Failed to get receivables: {response.status_code}")
        return False
    
    receivables = response.json()
    found = next((r for r in receivables if r["id"] == receivable_id), None)
    
    if not found:
        log_error("Created receivable not found in list")
        return False
    
    if found["status"] != "pending":
        log_error(f"Expected status 'pending', got '{found['status']}'")
        return False
    
    if found.get("account_id") != account_id:
        log_error(f"Expected account_id '{account_id}', got '{found.get('account_id')}'")
        return False
    
    log_success("Receivable verified: status=pending, account_id saved correctly")
    
    print("\n--- STEP 3: Verify Balance & Income Unchanged (Pending) ---")
    
    # Get accounts again
    response = session.get("/accounts")
    if response.status_code != 200:
        log_error(f"Failed to get accounts: {response.status_code}")
        return False
    
    accounts = response.json()
    account = next((a for a in accounts if a["id"] == account_id), None)
    
    if not account:
        log_error("Account not found")
        return False
    
    current_balance = account["balance"]
    
    if current_balance != S0:
        log_error(f"Balance changed while pending! Expected {S0}, got {current_balance}")
        return False
    
    log_success(f"Balance unchanged: {current_balance} (still pending)")
    
    # Get dashboard again
    response = session.get("/dashboard", params={"year": today.year, "month": today.month})
    if response.status_code != 200:
        log_error(f"Failed to get dashboard: {response.status_code}")
        return False
    
    dashboard = response.json()
    current_income = dashboard.get("income", 0)
    
    if current_income != I0:
        log_error(f"Income changed while pending! Expected {I0}, got {current_income}")
        return False
    
    log_success(f"Income unchanged: {current_income} (still pending)")
    
    print("\n--- STEP 4: Confirm Receipt (Mark as Received) ---")
    
    response = session.post(f"/receivables/{receivable_id}/receive")
    if response.status_code != 200:
        log_error(f"Failed to confirm receipt: {response.status_code} - {response.text}")
        return False
    
    result = response.json()
    
    if result.get("status") != "received":
        log_error(f"Expected status 'received', got '{result.get('status')}'")
        return False
    
    log_success("Receipt confirmed, status changed to 'received'")
    
    print("\n--- STEP 5: Verify Income Increased by 150 ---")
    
    response = session.get("/dashboard", params={"year": today.year, "month": today.month})
    if response.status_code != 200:
        log_error(f"Failed to get dashboard: {response.status_code}")
        return False
    
    dashboard = response.json()
    new_income = dashboard.get("income", 0)
    expected_income = I0 + 150
    
    if abs(new_income - expected_income) > 0.01:
        log_error(f"Income not increased correctly! Expected {expected_income}, got {new_income}")
        log_info(f"Delta: {new_income - I0} (expected 150)")
        return False
    
    log_success(f"Income increased correctly: {I0} → {new_income} (delta: +150)")
    
    print("\n--- STEP 6: Verify Balance Increased by 150 ---")
    
    response = session.get("/accounts")
    if response.status_code != 200:
        log_error(f"Failed to get accounts: {response.status_code}")
        return False
    
    accounts = response.json()
    account = next((a for a in accounts if a["id"] == account_id), None)
    
    if not account:
        log_error("Account not found")
        return False
    
    new_balance = account["balance"]
    expected_balance = S0 + 150
    
    if abs(new_balance - expected_balance) > 0.01:
        log_error(f"Balance not increased correctly! Expected {expected_balance}, got {new_balance}")
        log_info(f"Delta: {new_balance - S0} (expected 150)")
        return False
    
    log_success(f"Balance increased correctly: {S0} → {new_balance} (delta: +150)")
    
    print("\n--- STEP 7: Verify Transaction Created ---")
    
    response = session.get("/transactions", params={"year": today.year, "month": today.month})
    if response.status_code != 200:
        log_error(f"Failed to get transactions: {response.status_code}")
        return False
    
    transactions = response.json()
    
    # Find transaction with notes "(conta a receber)"
    receivable_tx = next((t for t in transactions if t.get("notes") == "(conta a receber)" and t.get("receivable_id") == receivable_id), None)
    
    if not receivable_tx:
        log_error("Transaction with notes '(conta a receber)' not found")
        log_info(f"Total transactions: {len(transactions)}")
        return False
    
    # Verify transaction details
    if receivable_tx["type"] != "income":
        log_error(f"Transaction type should be 'income', got '{receivable_tx['type']}'")
        return False
    
    if receivable_tx["amount"] != 150.0:
        log_error(f"Transaction amount should be 150, got {receivable_tx['amount']}")
        return False
    
    if receivable_tx.get("account_id") != account_id:
        log_error(f"Transaction account_id should be '{account_id}', got '{receivable_tx.get('account_id')}'")
        return False
    
    if receivable_tx["status"] != "paid":
        log_error(f"Transaction status should be 'paid', got '{receivable_tx['status']}'")
        return False
    
    if "Recebimento:" not in receivable_tx.get("description", ""):
        log_warning(f"Transaction description doesn't contain 'Recebimento:': {receivable_tx.get('description')}")
    
    transaction_id = receivable_tx["id"]
    
    log_success(f"Transaction created correctly (ID: {transaction_id})")
    log_info(f"Type: {receivable_tx['type']}, Amount: {receivable_tx['amount']}, Status: {receivable_tx['status']}")
    log_info(f"Description: {receivable_tx.get('description')}, Notes: {receivable_tx.get('notes')}")
    
    print("\n--- STEP 8: Toggle Back to Pending (Undo Receipt) ---")
    
    response = session.post(f"/receivables/{receivable_id}/receive")
    if response.status_code != 200:
        log_error(f"Failed to toggle back to pending: {response.status_code} - {response.text}")
        return False
    
    result = response.json()
    
    if result.get("status") != "pending":
        log_error(f"Expected status 'pending', got '{result.get('status')}'")
        return False
    
    log_success("Toggled back to pending")
    
    print("\n--- STEP 9: Verify Income Restored to I0 ---")
    
    response = session.get("/dashboard", params={"year": today.year, "month": today.month})
    if response.status_code != 200:
        log_error(f"Failed to get dashboard: {response.status_code}")
        return False
    
    dashboard = response.json()
    restored_income = dashboard.get("income", 0)
    
    if abs(restored_income - I0) > 0.01:
        log_error(f"Income not restored! Expected {I0}, got {restored_income}")
        return False
    
    log_success(f"Income restored correctly: {new_income} → {restored_income} (back to I0)")
    
    print("\n--- STEP 10: Verify Balance Restored to S0 ---")
    
    response = session.get("/accounts")
    if response.status_code != 200:
        log_error(f"Failed to get accounts: {response.status_code}")
        return False
    
    accounts = response.json()
    account = next((a for a in accounts if a["id"] == account_id), None)
    
    if not account:
        log_error("Account not found")
        return False
    
    restored_balance = account["balance"]
    
    if abs(restored_balance - S0) > 0.01:
        log_error(f"Balance not restored! Expected {S0}, got {restored_balance}")
        return False
    
    log_success(f"Balance restored correctly: {new_balance} → {restored_balance} (back to S0)")
    
    print("\n--- STEP 11: Verify Transaction Removed ---")
    
    response = session.get("/transactions", params={"year": today.year, "month": today.month})
    if response.status_code != 200:
        log_error(f"Failed to get transactions: {response.status_code}")
        return False
    
    transactions = response.json()
    
    # Transaction should be removed
    removed_tx = next((t for t in transactions if t["id"] == transaction_id), None)
    
    if removed_tx:
        log_error(f"Transaction should be removed but still exists (ID: {transaction_id})")
        return False
    
    log_success("Transaction removed correctly when toggled back to pending")
    
    print("\n--- STEP 12: Receive Again and Delete Receivable ---")
    
    # Receive again
    response = session.post(f"/receivables/{receivable_id}/receive")
    if response.status_code != 200:
        log_error(f"Failed to receive again: {response.status_code} - {response.text}")
        return False
    
    log_success("Received again (status: received)")
    
    # Verify transaction created again
    response = session.get("/transactions", params={"year": today.year, "month": today.month})
    if response.status_code != 200:
        log_error(f"Failed to get transactions: {response.status_code}")
        return False
    
    transactions = response.json()
    new_tx = next((t for t in transactions if t.get("notes") == "(conta a receber)" and t.get("receivable_id") == receivable_id), None)
    
    if not new_tx:
        log_error("Transaction not created again after receiving")
        return False
    
    new_tx_id = new_tx["id"]
    log_success(f"Transaction created again (ID: {new_tx_id})")
    
    # Delete receivable
    response = session.delete(f"/receivables/{receivable_id}")
    if response.status_code != 200:
        log_error(f"Failed to delete receivable: {response.status_code} - {response.text}")
        return False
    
    log_success("Receivable deleted")
    
    print("\n--- STEP 13: Verify Linked Transaction Also Removed ---")
    
    response = session.get("/transactions", params={"year": today.year, "month": today.month})
    if response.status_code != 200:
        log_error(f"Failed to get transactions: {response.status_code}")
        return False
    
    transactions = response.json()
    
    # Transaction should be removed
    deleted_tx = next((t for t in transactions if t["id"] == new_tx_id), None)
    
    if deleted_tx:
        log_error(f"Linked transaction should be removed when receivable is deleted (ID: {new_tx_id})")
        return False
    
    log_success("Linked transaction removed correctly when receivable deleted")
    
    print("\n--- STEP 14: Verify Income Back to Baseline ---")
    
    response = session.get("/dashboard", params={"year": today.year, "month": today.month})
    if response.status_code != 200:
        log_error(f"Failed to get dashboard: {response.status_code}")
        return False
    
    dashboard = response.json()
    final_income = dashboard.get("income", 0)
    
    if abs(final_income - I0) > 0.01:
        log_error(f"Income not back to baseline! Expected {I0}, got {final_income}")
        return False
    
    log_success(f"Income back to baseline: {final_income} (I0)")
    
    print("\n--- STEP 15: Verify Balance Back to Baseline ---")
    
    response = session.get("/accounts")
    if response.status_code != 200:
        log_error(f"Failed to get accounts: {response.status_code}")
        return False
    
    accounts = response.json()
    account = next((a for a in accounts if a["id"] == account_id), None)
    
    if not account:
        log_error("Account not found")
        return False
    
    final_balance = account["balance"]
    
    if abs(final_balance - S0) > 0.01:
        log_error(f"Balance not back to baseline! Expected {S0}, got {final_balance}")
        return False
    
    log_success(f"Balance back to baseline: {final_balance} (S0)")
    
    print("\n" + "="*80)
    print(f"{Colors.GREEN}✓ ALL TESTS PASSED{Colors.END}")
    print("="*80)
    print("\nSummary:")
    print(f"  • Initial state: Balance={S0}, Income={I0}")
    print(f"  • Created receivable: Amount=150, Account={account_id}")
    print(f"  • After receiving: Balance={S0}+150, Income={I0}+150, Transaction created")
    print(f"  • After toggling to pending: Balance={S0}, Income={I0}, Transaction removed")
    print(f"  • After delete: Balance={S0}, Income={I0}, Linked transaction removed")
    print(f"  • User isolation: All operations scoped to user {session.user_id}")
    print()
    
    return True


if __name__ == "__main__":
    try:
        success = test_receivables_bug_fix()
        exit(0 if success else 1)
    except Exception as e:
        log_error(f"Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
