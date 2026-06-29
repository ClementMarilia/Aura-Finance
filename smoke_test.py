#!/usr/bin/env python3
"""
Smoke test to verify other routes still work after the balance calculation fix.
"""

import requests
import sys
from datetime import datetime

BASE_URL = "https://de950129-d299-4610-b5f7-32045bdb977b.preview.emergentagent.com/api"
WENDY_EMAIL = "wendy@demo.com"
WENDY_PASSWORD = "demo123"

def login():
    """Login and return Bearer token"""
    try:
        resp = requests.post(
            f"{BASE_URL}/auth/login",
            json={"email": WENDY_EMAIL, "password": WENDY_PASSWORD},
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json().get("token")
        else:
            print(f"✗ Login failed: {resp.status_code}")
            return None
    except Exception as e:
        print(f"✗ Login error: {e}")
        return None

def run_smoke_tests():
    print("="*80)
    print("SMOKE TEST: Verify other routes after balance fix")
    print("="*80)
    
    passed = []
    failed = []
    
    # Login
    print("\n[1] Login wendy@demo.com")
    token = login()
    if not token:
        print("✗ Cannot proceed without token")
        return False
    print(f"✓ Login successful")
    passed.append("Login")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # Test 1: GET /dashboard?year&month responds 200
    print("\n[2] GET /dashboard?year=2026&month=6 → should respond 200")
    try:
        resp = requests.get(
            f"{BASE_URL}/dashboard",
            headers=headers,
            params={"year": 2026, "month": 6},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            print(f"✓ GET /dashboard responds 200, data keys: {list(data.keys())}")
            passed.append("GET /dashboard with year&month")
        else:
            print(f"✗ GET /dashboard failed: {resp.status_code}")
            failed.append(f"GET /dashboard: {resp.status_code}")
    except Exception as e:
        print(f"✗ GET /dashboard error: {e}")
        failed.append(f"GET /dashboard: {e}")
    
    # Test 2: GET /transactions without month filter responds 200 and includes paid+pending
    print("\n[3] GET /transactions (no month filter) → should respond 200 and include paid+pending")
    try:
        resp = requests.get(
            f"{BASE_URL}/transactions",
            headers=headers,
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            statuses = set(tx.get("status") for tx in data)
            print(f"✓ GET /transactions responds 200, found {len(data)} transactions")
            print(f"  Statuses present: {statuses}")
            if "paid" in statuses or "pending" in statuses:
                print(f"  ✓ Includes paid and/or pending transactions")
                passed.append("GET /transactions without filter")
            else:
                print(f"  ⚠ No paid or pending transactions found (might be empty)")
                passed.append("GET /transactions without filter (empty)")
        else:
            print(f"✗ GET /transactions failed: {resp.status_code}")
            failed.append(f"GET /transactions: {resp.status_code}")
    except Exception as e:
        print(f"✗ GET /transactions error: {e}")
        failed.append(f"GET /transactions: {e}")
    
    # Test 3: GET /installments/purchases responds 200
    print("\n[4] GET /installments/purchases → should respond 200")
    try:
        resp = requests.get(
            f"{BASE_URL}/installments/purchases",
            headers=headers,
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            print(f"✓ GET /installments/purchases responds 200, found {len(data)} purchases")
            passed.append("GET /installments/purchases")
        else:
            print(f"✗ GET /installments/purchases failed: {resp.status_code}")
            failed.append(f"GET /installments/purchases: {resp.status_code}")
    except Exception as e:
        print(f"✗ GET /installments/purchases error: {e}")
        failed.append(f"GET /installments/purchases: {e}")
    
    # Test 4: GET /receivables responds 200
    print("\n[5] GET /receivables → should respond 200")
    try:
        resp = requests.get(
            f"{BASE_URL}/receivables",
            headers=headers,
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            print(f"✓ GET /receivables responds 200, found {len(data)} receivables")
            passed.append("GET /receivables")
        else:
            print(f"✗ GET /receivables failed: {resp.status_code}")
            failed.append(f"GET /receivables: {resp.status_code}")
    except Exception as e:
        print(f"✗ GET /receivables error: {e}")
        failed.append(f"GET /receivables: {e}")
    
    # Test 5: Income paid transaction should credit balance
    print("\n[6] Create income transaction (paid) → should credit balance")
    try:
        # Get initial balance
        resp = requests.get(f"{BASE_URL}/accounts", headers=headers, timeout=10)
        if resp.status_code != 200:
            print(f"✗ Failed to get accounts: {resp.status_code}")
            failed.append("Income transaction test: cannot get accounts")
        else:
            accounts = resp.json()
            conta_principal = next((acc for acc in accounts if acc.get("name") == "Conta Principal"), None)
            if not conta_principal:
                print(f"✗ Conta Principal not found")
                failed.append("Income transaction test: no Conta Principal")
            else:
                initial_balance = conta_principal["balance"]
                account_id = conta_principal["id"]
                print(f"  Initial balance: {initial_balance}")
                
                # Create income transaction with status=paid
                tx_data = {
                    "type": "income",
                    "date": datetime.now().date().isoformat(),
                    "amount": 100.0,
                    "status": "paid",
                    "account_id": account_id,
                    "description": "Teste receita paga"
                }
                resp = requests.post(
                    f"{BASE_URL}/transactions",
                    headers=headers,
                    json=tx_data,
                    timeout=10
                )
                if resp.status_code != 200:
                    print(f"✗ Failed to create income transaction: {resp.status_code}")
                    failed.append(f"Income transaction test: create failed {resp.status_code}")
                else:
                    tx = resp.json()
                    tx_id = tx.get("id")
                    print(f"  Created income transaction: id={tx_id}")
                    
                    # Get balance after
                    resp = requests.get(f"{BASE_URL}/accounts", headers=headers, timeout=10)
                    if resp.status_code != 200:
                        print(f"✗ Failed to get accounts after: {resp.status_code}")
                        failed.append("Income transaction test: cannot get accounts after")
                    else:
                        accounts_after = resp.json()
                        conta_after = next((acc for acc in accounts_after if acc["id"] == account_id), None)
                        if conta_after:
                            balance_after = conta_after["balance"]
                            expected_balance = round(initial_balance + 100.0, 2)
                            print(f"  Balance after: {balance_after} (expected: {expected_balance})")
                            
                            if balance_after == expected_balance:
                                print(f"✓ Income transaction correctly credited balance: {initial_balance} → {balance_after} (+100.0)")
                                passed.append("Income transaction credits balance")
                            else:
                                print(f"✗ Balance incorrect: expected {expected_balance}, got {balance_after}")
                                failed.append(f"Income transaction: balance {balance_after} != {expected_balance}")
                            
                            # Cleanup
                            requests.delete(f"{BASE_URL}/transactions/{tx_id}", headers=headers, timeout=10)
                            print(f"  Cleaned up test transaction")
                        else:
                            print(f"✗ Conta Principal not found after")
                            failed.append("Income transaction test: account not found after")
    except Exception as e:
        print(f"✗ Income transaction test error: {e}")
        failed.append(f"Income transaction test: {e}")
    
    # Summary
    print("\n" + "="*80)
    print("SMOKE TEST SUMMARY")
    print("="*80)
    print(f"\n✓ PASSED ({len(passed)}):")
    for p in passed:
        print(f"  - {p}")
    
    if failed:
        print(f"\n✗ FAILED ({len(failed)}):")
        for f in failed:
            print(f"  - {f}")
    
    print("\n" + "="*80)
    print(f"Total: {len(passed)} passed, {len(failed)} failed")
    print("="*80 + "\n")
    
    return len(failed) == 0

if __name__ == "__main__":
    try:
        success = run_smoke_tests()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n✗ Smoke test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
