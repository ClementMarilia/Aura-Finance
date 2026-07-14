#!/usr/bin/env python3
"""
Backend test for "Confirmar pagamento em Lançamentos + roll-over" feature.
Tests ONLY the backend API endpoints.

Test scenarios:
1) Login wendy → token Bearer
2) GET /accounts → note "Conta Principal" (id and initial balance S0)
3) Create REAL expense with date from LAST MONTH, status="pending", amount=77.50
4) GET /accounts → balance remains S0 (pending doesn't affect balance)
5) GET /transactions?year=Y&month=M (current month) → transaction appears with overdue=true, editable=true
6) GET /transactions?year=Y&month=M&status=paid → transaction should NOT appear
7) GET /transactions?year=Y&month=M&status=pending → MUST appear with overdue=true
8) POST /transactions/{tx_id}/pay → 200, returns {"ok":true,"status":"paid"}
9) GET /transactions?year=Y&month=M → should NOT appear (status=paid, date outside month)
10) GET /transactions?year=LAST_Y&month=LAST_M → appears with overdue=false
11) GET /accounts → balance now is S0 - 77.50
12) POST /transactions/{tx_id}/pay again → 200, returns {"status":"pending"}
13) GET /accounts → balance returns to S0
14) GET /transactions?year=Y&month=M → reappears with overdue=true
15) Edge cases:
    a) POST /transactions/inexistente-id/pay → 404
    b) Create cancelled transaction, call /pay → 400
16) User isolation: login marilia, GET /transactions doesn't include wendy's transaction
17) Filter account_id: create another pending expense in different account
18) Cleanup: DELETE created transactions
"""

import requests
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Optional

# Base URL from frontend/.env
BASE_URL = "https://de950129-d299-4610-b5f7-32045bdb977b.preview.emergentagent.com/api"

# Test credentials
WENDY_EMAIL = "wendy@demo.com"
WENDY_PASSWORD = "demo123"
MARILIA_EMAIL = "marilia@demo.com"
MARILIA_PASSWORD = "demo123"

class TestResult:
    def __init__(self):
        self.passed = []
        self.failed = []
        self.warnings = []
    
    def add_pass(self, test_name: str, details: str = ""):
        self.passed.append(f"✓ {test_name}" + (f": {details}" if details else ""))
    
    def add_fail(self, test_name: str, details: str):
        self.failed.append(f"✗ {test_name}: {details}")
    
    def add_warning(self, test_name: str, details: str):
        self.warnings.append(f"⚠ {test_name}: {details}")
    
    def print_summary(self):
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        
        if self.passed:
            print(f"\n✓ PASSED ({len(self.passed)}):")
            for p in self.passed:
                print(f"  {p}")
        
        if self.warnings:
            print(f"\n⚠ WARNINGS ({len(self.warnings)}):")
            for w in self.warnings:
                print(f"  {w}")
        
        if self.failed:
            print(f"\n✗ FAILED ({len(self.failed)}):")
            for f in self.failed:
                print(f"  {f}")
        
        print("\n" + "="*80)
        print(f"Total: {len(self.passed)} passed, {len(self.failed)} failed, {len(self.warnings)} warnings")
        print("="*80 + "\n")
        
        return len(self.failed) == 0


def login(email: str, password: str) -> Optional[str]:
    """Login and return Bearer token"""
    try:
        resp = requests.post(
            f"{BASE_URL}/auth/login",
            json={"email": email, "password": password},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get("token")
        else:
            print(f"Login failed for {email}: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"Login error for {email}: {e}")
        return None


def get_accounts(token: str) -> Optional[List[Dict]]:
    """Get all accounts for the authenticated user"""
    try:
        resp = requests.get(
            f"{BASE_URL}/accounts",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"GET /accounts failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"GET /accounts error: {e}")
        return None


def get_transactions(token: str, year: int = None, month: int = None, 
                    status: str = None, account_id: str = None) -> Optional[List[Dict]]:
    """Get transactions with optional filters"""
    try:
        params = {}
        if year:
            params["year"] = year
        if month:
            params["month"] = month
        if status:
            params["status"] = status
        if account_id:
            params["account_id"] = account_id
        
        resp = requests.get(
            f"{BASE_URL}/transactions",
            headers={"Authorization": f"Bearer {token}"},
            params=params,
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"GET /transactions failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"GET /transactions error: {e}")
        return None


def create_transaction(token: str, tx_data: Dict) -> Optional[Dict]:
    """Create a new transaction"""
    try:
        resp = requests.post(
            f"{BASE_URL}/transactions",
            headers={"Authorization": f"Bearer {token}"},
            json=tx_data,
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"POST /transactions failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"POST /transactions error: {e}")
        return None


def toggle_transaction_payment(token: str, tx_id: str) -> Optional[Dict]:
    """Toggle transaction payment status (paid <-> pending)"""
    try:
        resp = requests.post(
            f"{BASE_URL}/transactions/{tx_id}/pay",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        return {
            "status_code": resp.status_code,
            "data": resp.json() if resp.status_code == 200 else None,
            "text": resp.text
        }
    except Exception as e:
        print(f"POST /transactions/{tx_id}/pay error: {e}")
        return None


def delete_transaction(token: str, tx_id: str) -> bool:
    """Delete a transaction"""
    try:
        resp = requests.delete(
            f"{BASE_URL}/transactions/{tx_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        return resp.status_code == 200
    except Exception as e:
        print(f"DELETE /transactions error: {e}")
        return False


def run_tests():
    result = TestResult()
    
    print("="*80)
    print("BACKEND TEST: Confirmar pagamento em Lançamentos + roll-over")
    print("="*80)
    
    # Calculate dates
    today = datetime.now()
    current_year = today.year
    current_month = today.month
    
    # Last month date (for creating overdue transaction)
    if current_month == 1:
        last_month = 12
        last_year = current_year - 1
    else:
        last_month = current_month - 1
        last_year = current_year
    
    # Create a date from last month (e.g., 15th of last month)
    last_month_date = datetime(last_year, last_month, 15).date().isoformat()
    
    print(f"\nTest dates:")
    print(f"  Current month: {current_year}-{current_month:02d}")
    print(f"  Last month: {last_year}-{last_month:02d}")
    print(f"  Transaction date (last month): {last_month_date}")
    
    # Variables to store test data
    wendy_token = None
    conta_principal_id = None
    initial_balance = None
    tx_id = None
    tx_id_cancelled = None
    tx_id_other_account = None
    other_account_id = None
    
    # Test 1: Login with wendy@demo.com
    print("\n[Test 1] Login with wendy@demo.com / demo123")
    wendy_token = login(WENDY_EMAIL, WENDY_PASSWORD)
    if wendy_token:
        result.add_pass("Test 1: Login wendy", f"Bearer token received")
        print(f"✓ Login successful, token: {wendy_token[:20]}...")
    else:
        result.add_fail("Test 1: Login wendy", "Failed to get token")
        print("✗ Login failed")
        result.print_summary()
        return False
    
    # Test 2: GET /accounts - note "Conta Principal" id and initial balance
    print("\n[Test 2] GET /accounts - note 'Conta Principal' id and initial balance S0")
    accounts = get_accounts(wendy_token)
    if accounts is None:
        result.add_fail("Test 2: GET /accounts", "Failed to fetch accounts")
        result.print_summary()
        return False
    
    # Find "Conta Principal"
    conta_principal = next((acc for acc in accounts if acc.get("name") == "Conta Principal"), None)
    if conta_principal:
        conta_principal_id = conta_principal["id"]
        initial_balance = conta_principal["balance"]
        result.add_pass("Test 2: GET /accounts", 
                       f"Found 'Conta Principal' - id={conta_principal_id}, balance S0={initial_balance}")
        print(f"✓ Found 'Conta Principal': id={conta_principal_id}, initial balance S0={initial_balance}")
    else:
        result.add_fail("Test 2: GET /accounts", "'Conta Principal' not found")
        print("✗ 'Conta Principal' not found")
        result.print_summary()
        return False
    
    # Test 3: Create REAL expense with date from LAST MONTH, status="pending"
    print(f"\n[Test 3] Create expense with date from last month ({last_month_date}), status='pending', amount=77.50")
    tx_data = {
        "type": "expense",
        "date": last_month_date,
        "amount": 77.50,
        "status": "pending",
        "account_id": conta_principal_id,
        "description": "Aluguel atrasado",
        "notes": "Teste roll-over"
    }
    tx = create_transaction(wendy_token, tx_data)
    if tx and tx.get("id"):
        tx_id = tx["id"]
        result.add_pass("Test 3: Create pending expense", 
                       f"Created transaction id={tx_id}, date={last_month_date}, status=pending, amount=77.50")
        print(f"✓ Created transaction: id={tx_id}")
    else:
        result.add_fail("Test 3: Create pending expense", "Failed to create transaction")
        print("✗ Failed to create transaction")
        result.print_summary()
        return False
    
    # Test 4: GET /accounts - balance should remain S0 (pending doesn't affect balance)
    print("\n[Test 4] GET /accounts - verify balance remains S0 (pending doesn't affect balance)")
    accounts_after = get_accounts(wendy_token)
    if accounts_after:
        conta_principal_after = next((acc for acc in accounts_after if acc["id"] == conta_principal_id), None)
        if conta_principal_after:
            balance_after = conta_principal_after["balance"]
            if balance_after == initial_balance:
                result.add_pass("Test 4: Balance unchanged (pending)", 
                               f"Balance remains S0={initial_balance} (pending transaction doesn't affect balance)")
                print(f"✓ Balance remains S0={initial_balance} (pending doesn't affect balance)")
            else:
                result.add_fail("Test 4: Balance unchanged (pending)", 
                               f"Balance changed from {initial_balance} to {balance_after} (should remain unchanged)")
                print(f"✗ Balance changed from {initial_balance} to {balance_after}")
        else:
            result.add_fail("Test 4: Balance unchanged (pending)", "Conta Principal not found")
    else:
        result.add_fail("Test 4: Balance unchanged (pending)", "Failed to fetch accounts")
    
    # Test 5: GET /transactions?year=Y&month=M (current month) → transaction appears with overdue=true, editable=true
    print(f"\n[Test 5] GET /transactions?year={current_year}&month={current_month} → transaction appears with overdue=true, editable=true")
    txs_current_month = get_transactions(wendy_token, year=current_year, month=current_month)
    if txs_current_month is not None:
        tx_found = next((t for t in txs_current_month if t.get("id") == tx_id), None)
        if tx_found:
            overdue = tx_found.get("overdue")
            editable = tx_found.get("editable")
            if overdue == True and editable == True:
                result.add_pass("Test 5: Roll-over transaction appears", 
                               f"Transaction appears in current month with overdue=true, editable=true")
                print(f"✓ Transaction appears with overdue={overdue}, editable={editable}")
            else:
                result.add_fail("Test 5: Roll-over transaction appears", 
                               f"Transaction found but overdue={overdue}, editable={editable} (expected both true)")
                print(f"✗ Transaction found but overdue={overdue}, editable={editable}")
        else:
            result.add_fail("Test 5: Roll-over transaction appears", 
                           f"Transaction id={tx_id} NOT found in current month (should appear as overdue)")
            print(f"✗ Transaction NOT found in current month")
    else:
        result.add_fail("Test 5: Roll-over transaction appears", "Failed to fetch transactions")
    
    # Test 6: GET /transactions?year=Y&month=M&status=paid → transaction should NOT appear
    print(f"\n[Test 6] GET /transactions?year={current_year}&month={current_month}&status=paid → transaction should NOT appear")
    txs_paid = get_transactions(wendy_token, year=current_year, month=current_month, status="paid")
    if txs_paid is not None:
        tx_found_paid = next((t for t in txs_paid if t.get("id") == tx_id), None)
        if not tx_found_paid:
            result.add_pass("Test 6: Filter status=paid excludes overdue", 
                           "Transaction correctly NOT included when filtering by status=paid")
            print(f"✓ Transaction correctly NOT included with status=paid filter")
        else:
            result.add_fail("Test 6: Filter status=paid excludes overdue", 
                           "Transaction appears with status=paid filter (should be excluded)")
            print(f"✗ Transaction appears with status=paid filter (should be excluded)")
    else:
        result.add_fail("Test 6: Filter status=paid excludes overdue", "Failed to fetch transactions")
    
    # Test 7: GET /transactions?year=Y&month=M&status=pending → MUST appear with overdue=true
    print(f"\n[Test 7] GET /transactions?year={current_year}&month={current_month}&status=pending → MUST appear with overdue=true")
    txs_pending = get_transactions(wendy_token, year=current_year, month=current_month, status="pending")
    if txs_pending is not None:
        tx_found_pending = next((t for t in txs_pending if t.get("id") == tx_id), None)
        if tx_found_pending:
            overdue_pending = tx_found_pending.get("overdue")
            if overdue_pending == True:
                result.add_pass("Test 7: Filter status=pending includes overdue", 
                               "Transaction appears with status=pending filter and overdue=true")
                print(f"✓ Transaction appears with status=pending filter, overdue={overdue_pending}")
            else:
                result.add_fail("Test 7: Filter status=pending includes overdue", 
                               f"Transaction found but overdue={overdue_pending} (expected true)")
                print(f"✗ Transaction found but overdue={overdue_pending}")
        else:
            result.add_fail("Test 7: Filter status=pending includes overdue", 
                           "Transaction NOT found with status=pending filter")
            print(f"✗ Transaction NOT found with status=pending filter")
    else:
        result.add_fail("Test 7: Filter status=pending includes overdue", "Failed to fetch transactions")
    
    # Test 8: POST /transactions/{tx_id}/pay → 200, returns {"ok":true,"status":"paid"}
    print(f"\n[Test 8] POST /transactions/{tx_id}/pay → toggle to paid")
    pay_result = toggle_transaction_payment(wendy_token, tx_id)
    if pay_result and pay_result["status_code"] == 200:
        data = pay_result["data"]
        if data and data.get("ok") == True and data.get("status") == "paid":
            result.add_pass("Test 8: Toggle to paid", 
                           f"Successfully toggled to paid: {data}")
            print(f"✓ Successfully toggled to paid: {data}")
        else:
            result.add_fail("Test 8: Toggle to paid", 
                           f"Response OK but unexpected data: {data}")
            print(f"✗ Response OK but unexpected data: {data}")
    else:
        result.add_fail("Test 8: Toggle to paid", 
                       f"Failed: status={pay_result.get('status_code') if pay_result else 'None'}")
        print(f"✗ Failed to toggle to paid")
    
    # Test 9: GET /transactions?year=Y&month=M → should NOT appear (status=paid, date outside month)
    print(f"\n[Test 9] GET /transactions?year={current_year}&month={current_month} → should NOT appear (status=paid, date outside month)")
    txs_after_pay = get_transactions(wendy_token, year=current_year, month=current_month)
    if txs_after_pay is not None:
        tx_found_after_pay = next((t for t in txs_after_pay if t.get("id") == tx_id), None)
        if not tx_found_after_pay:
            result.add_pass("Test 9: Paid transaction not in current month", 
                           "Transaction correctly NOT appears in current month after marking as paid")
            print(f"✓ Transaction correctly NOT appears in current month (paid, date outside)")
        else:
            result.add_fail("Test 9: Paid transaction not in current month", 
                           f"Transaction still appears in current month (should not, status={tx_found_after_pay.get('status')})")
            print(f"✗ Transaction still appears in current month")
    else:
        result.add_fail("Test 9: Paid transaction not in current month", "Failed to fetch transactions")
    
    # Test 10: GET /transactions?year=LAST_Y&month=LAST_M → appears with overdue=false
    print(f"\n[Test 10] GET /transactions?year={last_year}&month={last_month} → appears with overdue=false")
    txs_last_month = get_transactions(wendy_token, year=last_year, month=last_month)
    if txs_last_month is not None:
        tx_found_last_month = next((t for t in txs_last_month if t.get("id") == tx_id), None)
        if tx_found_last_month:
            overdue_last = tx_found_last_month.get("overdue")
            status_last = tx_found_last_month.get("status")
            if overdue_last == False and status_last == "paid":
                result.add_pass("Test 10: Transaction in its own month", 
                               f"Transaction appears in its own month with overdue=false, status=paid")
                print(f"✓ Transaction appears in last month with overdue={overdue_last}, status={status_last}")
            else:
                result.add_fail("Test 10: Transaction in its own month", 
                               f"Transaction found but overdue={overdue_last}, status={status_last}")
                print(f"✗ Transaction found but overdue={overdue_last}, status={status_last}")
        else:
            result.add_fail("Test 10: Transaction in its own month", 
                           "Transaction NOT found in its own month")
            print(f"✗ Transaction NOT found in last month")
    else:
        result.add_fail("Test 10: Transaction in its own month", "Failed to fetch transactions")
    
    # Test 11: GET /accounts → balance now is S0 - 77.50
    print(f"\n[Test 11] GET /accounts → balance now is S0 - 77.50 = {initial_balance - 77.50}")
    accounts_after_pay = get_accounts(wendy_token)
    if accounts_after_pay:
        conta_after_pay = next((acc for acc in accounts_after_pay if acc["id"] == conta_principal_id), None)
        if conta_after_pay:
            balance_after_pay = conta_after_pay["balance"]
            expected_balance = round(initial_balance - 77.50, 2)
            if balance_after_pay == expected_balance:
                result.add_pass("Test 11: Balance reduced after paid", 
                               f"Balance correctly reduced: {initial_balance} → {balance_after_pay} (delta: -77.50)")
                print(f"✓ Balance correctly reduced: {initial_balance} → {balance_after_pay}")
            else:
                result.add_fail("Test 11: Balance reduced after paid", 
                               f"Balance is {balance_after_pay}, expected {expected_balance}")
                print(f"✗ Balance is {balance_after_pay}, expected {expected_balance}")
        else:
            result.add_fail("Test 11: Balance reduced after paid", "Conta Principal not found")
    else:
        result.add_fail("Test 11: Balance reduced after paid", "Failed to fetch accounts")
    
    # Test 12: POST /transactions/{tx_id}/pay again → toggle back to pending
    print(f"\n[Test 12] POST /transactions/{tx_id}/pay again → toggle back to pending")
    unpay_result = toggle_transaction_payment(wendy_token, tx_id)
    if unpay_result and unpay_result["status_code"] == 200:
        data = unpay_result["data"]
        if data and data.get("ok") == True and data.get("status") == "pending":
            result.add_pass("Test 12: Toggle back to pending", 
                           f"Successfully toggled back to pending: {data}")
            print(f"✓ Successfully toggled back to pending: {data}")
        else:
            result.add_fail("Test 12: Toggle back to pending", 
                           f"Response OK but unexpected data: {data}")
            print(f"✗ Response OK but unexpected data: {data}")
    else:
        result.add_fail("Test 12: Toggle back to pending", 
                       f"Failed: status={unpay_result.get('status_code') if unpay_result else 'None'}")
        print(f"✗ Failed to toggle back to pending")
    
    # Test 13: GET /accounts → balance returns to S0
    print(f"\n[Test 13] GET /accounts → balance returns to S0 = {initial_balance}")
    accounts_after_unpay = get_accounts(wendy_token)
    if accounts_after_unpay:
        conta_after_unpay = next((acc for acc in accounts_after_unpay if acc["id"] == conta_principal_id), None)
        if conta_after_unpay:
            balance_after_unpay = conta_after_unpay["balance"]
            if balance_after_unpay == initial_balance:
                result.add_pass("Test 13: Balance restored after unpay", 
                               f"Balance correctly restored to S0={initial_balance}")
                print(f"✓ Balance correctly restored to S0={initial_balance}")
            else:
                result.add_fail("Test 13: Balance restored after unpay", 
                               f"Balance is {balance_after_unpay}, expected {initial_balance}")
                print(f"✗ Balance is {balance_after_unpay}, expected {initial_balance}")
        else:
            result.add_fail("Test 13: Balance restored after unpay", "Conta Principal not found")
    else:
        result.add_fail("Test 13: Balance restored after unpay", "Failed to fetch accounts")
    
    # Test 14: GET /transactions?year=Y&month=M → reappears with overdue=true
    print(f"\n[Test 14] GET /transactions?year={current_year}&month={current_month} → reappears with overdue=true")
    txs_after_unpay = get_transactions(wendy_token, year=current_year, month=current_month)
    if txs_after_unpay is not None:
        tx_found_after_unpay = next((t for t in txs_after_unpay if t.get("id") == tx_id), None)
        if tx_found_after_unpay:
            overdue_after_unpay = tx_found_after_unpay.get("overdue")
            status_after_unpay = tx_found_after_unpay.get("status")
            if overdue_after_unpay == True and status_after_unpay == "pending":
                result.add_pass("Test 14: Transaction reappears as overdue", 
                               f"Transaction reappears in current month with overdue=true, status=pending")
                print(f"✓ Transaction reappears with overdue={overdue_after_unpay}, status={status_after_unpay}")
            else:
                result.add_fail("Test 14: Transaction reappears as overdue", 
                               f"Transaction found but overdue={overdue_after_unpay}, status={status_after_unpay}")
                print(f"✗ Transaction found but overdue={overdue_after_unpay}, status={status_after_unpay}")
        else:
            result.add_fail("Test 14: Transaction reappears as overdue", 
                           "Transaction NOT found in current month (should reappear)")
            print(f"✗ Transaction NOT found in current month")
    else:
        result.add_fail("Test 14: Transaction reappears as overdue", "Failed to fetch transactions")
    
    # Test 15a: Edge case - POST /transactions/inexistente-id/pay → 404
    print(f"\n[Test 15a] Edge case: POST /transactions/inexistente-id/pay → 404")
    fake_id = "00000000-0000-0000-0000-000000000000"
    fake_result = toggle_transaction_payment(wendy_token, fake_id)
    if fake_result and fake_result["status_code"] == 404:
        result.add_pass("Test 15a: Edge case 404", 
                       "Correctly returns 404 for non-existent transaction")
        print(f"✓ Correctly returns 404 for non-existent transaction")
    else:
        result.add_fail("Test 15a: Edge case 404", 
                       f"Expected 404, got {fake_result.get('status_code') if fake_result else 'None'}")
        print(f"✗ Expected 404, got {fake_result.get('status_code') if fake_result else 'None'}")
    
    # Test 15b: Edge case - Create cancelled transaction, call /pay → 400
    print(f"\n[Test 15b] Edge case: Create cancelled transaction, call /pay → 400")
    tx_cancelled_data = {
        "type": "expense",
        "date": last_month_date,
        "amount": 50.0,
        "status": "cancelled",
        "account_id": conta_principal_id,
        "description": "Transação cancelada para teste"
    }
    tx_cancelled = create_transaction(wendy_token, tx_cancelled_data)
    if tx_cancelled and tx_cancelled.get("id"):
        tx_id_cancelled = tx_cancelled["id"]
        print(f"  Created cancelled transaction: id={tx_id_cancelled}")
        
        cancelled_pay_result = toggle_transaction_payment(wendy_token, tx_id_cancelled)
        if cancelled_pay_result and cancelled_pay_result["status_code"] == 400:
            result.add_pass("Test 15b: Edge case cancelled → 400", 
                           "Correctly returns 400 when trying to pay cancelled transaction")
            print(f"✓ Correctly returns 400 for cancelled transaction")
        else:
            result.add_fail("Test 15b: Edge case cancelled → 400", 
                           f"Expected 400, got {cancelled_pay_result.get('status_code') if cancelled_pay_result else 'None'}")
            print(f"✗ Expected 400, got {cancelled_pay_result.get('status_code') if cancelled_pay_result else 'None'}")
    else:
        result.add_warning("Test 15b: Edge case cancelled → 400", 
                          "Failed to create cancelled transaction")
        print(f"⚠ Failed to create cancelled transaction")
    
    # Test 16: User isolation - login marilia, GET /transactions doesn't include wendy's transaction
    print(f"\n[Test 16] User isolation: login marilia, verify wendy's transaction not visible")
    marilia_token = login(MARILIA_EMAIL, MARILIA_PASSWORD)
    if marilia_token:
        print(f"✓ Login marilia successful")
        
        marilia_txs = get_transactions(marilia_token, year=current_year, month=current_month)
        if marilia_txs is not None:
            wendy_tx_in_marilia = next((t for t in marilia_txs if t.get("id") == tx_id), None)
            if not wendy_tx_in_marilia:
                result.add_pass("Test 16: User isolation", 
                               "Wendy's transaction correctly NOT visible to Marilia")
                print(f"✓ User isolation verified: Wendy's transaction not visible to Marilia")
            else:
                result.add_fail("Test 16: User isolation", 
                               "Wendy's transaction appears in Marilia's list (isolation broken)")
                print(f"✗ User isolation FAILED: Wendy's transaction visible to Marilia")
        else:
            result.add_fail("Test 16: User isolation", "Failed to fetch Marilia's transactions")
    else:
        result.add_fail("Test 16: User isolation", "Failed to login as Marilia")
    
    # Test 17: Filter account_id - create another pending expense in different account
    print(f"\n[Test 17] Filter account_id: create expense in different account, verify filtering")
    
    # Find or create another account
    other_account = next((acc for acc in accounts if acc["id"] != conta_principal_id), None)
    if not other_account:
        # Create a new account for testing
        print("  Creating a new test account...")
        try:
            resp = requests.post(
                f"{BASE_URL}/accounts",
                headers={"Authorization": f"Bearer {wendy_token}"},
                json={"name": "Conta Teste", "type": "checking", "initial_balance": 0.0},
                timeout=10
            )
            if resp.status_code == 200:
                other_account = resp.json()
                print(f"  Created test account: id={other_account['id']}")
            else:
                print(f"  Failed to create test account: {resp.status_code}")
        except Exception as e:
            print(f"  Error creating test account: {e}")
    
    if other_account:
        other_account_id = other_account["id"]
        print(f"  Using account: id={other_account_id}, name={other_account.get('name')}")
        
        # Create another pending expense in the other account
        tx_other_data = {
            "type": "expense",
            "date": last_month_date,
            "amount": 100.0,
            "status": "pending",
            "account_id": other_account_id,
            "description": "Despesa em outra conta"
        }
        tx_other = create_transaction(wendy_token, tx_other_data)
        if tx_other and tx_other.get("id"):
            tx_id_other_account = tx_other["id"]
            print(f"  Created transaction in other account: id={tx_id_other_account}")
            
            # GET /transactions with account_id filter for conta_principal
            txs_filtered = get_transactions(wendy_token, year=current_year, month=current_month, 
                                           account_id=conta_principal_id)
            if txs_filtered is not None:
                tx_principal_found = next((t for t in txs_filtered if t.get("id") == tx_id), None)
                tx_other_found = next((t for t in txs_filtered if t.get("id") == tx_id_other_account), None)
                
                if tx_principal_found and not tx_other_found:
                    result.add_pass("Test 17: Filter by account_id", 
                                   "Filter correctly includes only transactions from specified account")
                    print(f"✓ Filter by account_id works: includes tx from conta_principal, excludes tx from other account")
                else:
                    result.add_fail("Test 17: Filter by account_id", 
                                   f"Filter failed: principal_found={bool(tx_principal_found)}, other_found={bool(tx_other_found)}")
                    print(f"✗ Filter by account_id failed")
            else:
                result.add_fail("Test 17: Filter by account_id", "Failed to fetch filtered transactions")
        else:
            result.add_warning("Test 17: Filter by account_id", "Failed to create transaction in other account")
    else:
        result.add_warning("Test 17: Filter by account_id", "No other account available for testing")
    
    # Test 18: Cleanup - DELETE created transactions
    print(f"\n[Test 18] Cleanup: DELETE created transactions")
    cleanup_success = True
    
    if tx_id:
        if delete_transaction(wendy_token, tx_id):
            print(f"✓ Deleted main test transaction: {tx_id}")
        else:
            print(f"⚠ Failed to delete main test transaction: {tx_id}")
            cleanup_success = False
    
    if tx_id_cancelled:
        if delete_transaction(wendy_token, tx_id_cancelled):
            print(f"✓ Deleted cancelled test transaction: {tx_id_cancelled}")
        else:
            print(f"⚠ Failed to delete cancelled test transaction: {tx_id_cancelled}")
            cleanup_success = False
    
    if tx_id_other_account:
        if delete_transaction(wendy_token, tx_id_other_account):
            print(f"✓ Deleted other account test transaction: {tx_id_other_account}")
        else:
            print(f"⚠ Failed to delete other account test transaction: {tx_id_other_account}")
            cleanup_success = False
    
    if cleanup_success:
        result.add_pass("Test 18: Cleanup", "All test transactions deleted successfully")
    else:
        result.add_warning("Test 18: Cleanup", "Some test transactions could not be deleted")
    
    # Print summary
    success = result.print_summary()
    return success


if __name__ == "__main__":
    try:
        success = run_tests()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n✗ Test execution failed with exception: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
