#!/usr/bin/env python3
"""
Backend API Test for Aurea Finance App
Testing BUGFIX: Editing recurrence should NOT duplicate transactions
"""

import requests
import json
from datetime import datetime, timedelta, date
from typing import Optional

# Base URL from frontend/.env
BASE_URL = "https://analyze-code-20.preview.emergentagent.com/api"

# Test credentials
TEST_EMAIL = "wendy@demo.com"
TEST_PASSWORD = "demo123"

class TestRecurrenceEditBugFix:
    def __init__(self):
        self.token = None
        self.headers = {}
        self.recurrence_id = None
        self.account_id = None
        
    def login(self):
        """Login and get Bearer token"""
        print("\n=== STEP 1: Login ===")
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        self.token = data["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
        print(f"✓ Login successful. User: {data['user']['name']}")
        return data["user"]["id"]
    
    def get_account(self):
        """Get an account/wallet for the recurrence"""
        print("\n=== STEP 2: Get Account ===")
        response = requests.get(f"{BASE_URL}/accounts", headers=self.headers)
        assert response.status_code == 200, f"Get accounts failed: {response.text}"
        accounts = response.json()
        assert len(accounts) > 0, "No accounts found"
        self.account_id = accounts[0]["id"]
        print(f"✓ Using account: {accounts[0]['name']} (ID: {self.account_id})")
        return self.account_id
    
    def create_monthly_recurrence(self):
        """Create a monthly recurrence starting today"""
        print("\n=== STEP 3: Create Monthly Recurrence ===")
        today = date.today().isoformat()
        
        payload = {
            "type": "expense",
            "amount": 100.0,
            "frequency": "monthly",
            "next_run": today,
            "description": "Assinatura X",
            "account_id": self.account_id
        }
        
        response = requests.post(
            f"{BASE_URL}/recurrences",
            headers=self.headers,
            json=payload
        )
        assert response.status_code == 200, f"Create recurrence failed: {response.text}"
        data = response.json()
        self.recurrence_id = data["id"]
        print(f"✓ Recurrence created: ID={self.recurrence_id}")
        print(f"  - Type: {data['type']}")
        print(f"  - Amount: {data['amount']}")
        print(f"  - Frequency: {data['frequency']}")
        print(f"  - Description: {data['description']}")
        print(f"  - Next run: {data['next_run']}")
        return self.recurrence_id
    
    def materialize_transactions(self, months_ahead=2):
        """Materialize transactions by querying current and future months"""
        print(f"\n=== STEP 4: Materialize Transactions (Current + {months_ahead} months ahead) ===")
        
        today = date.today()
        months_to_query = []
        
        # Current month
        months_to_query.append((today.year, today.month))
        
        # Future months
        for i in range(1, months_ahead + 1):
            future_date = today + timedelta(days=30 * i)
            months_to_query.append((future_date.year, future_date.month))
        
        all_transactions = []
        for year, month in months_to_query:
            response = requests.get(
                f"{BASE_URL}/transactions",
                headers=self.headers,
                params={"year": year, "month": month}
            )
            assert response.status_code == 200, f"Get transactions failed: {response.text}"
            transactions = response.json()
            all_transactions.extend(transactions)
            print(f"✓ Queried {year}-{month:02d}: {len(transactions)} transactions")
        
        return all_transactions
    
    def count_recurrence_transactions(self):
        """Count transactions linked to this recurrence across all materialized months"""
        print("\n=== STEP 5: Count Recurrence Transactions ===")
        
        # Query current month and 2 months ahead
        today = date.today()
        recurrence_txs = []
        
        for i in range(3):  # Current + 2 future months
            future_date = today + timedelta(days=30 * i)
            response = requests.get(
                f"{BASE_URL}/transactions",
                headers=self.headers,
                params={"year": future_date.year, "month": future_date.month}
            )
            assert response.status_code == 200, f"Get transactions failed: {response.text}"
            transactions = response.json()
            
            # Filter by recurrence_id
            for tx in transactions:
                if tx.get("recurrence_id") == self.recurrence_id:
                    recurrence_txs.append(tx)
        
        print(f"✓ Found {len(recurrence_txs)} transactions with recurrence_id={self.recurrence_id}")
        
        # Print details
        for tx in recurrence_txs:
            print(f"  - ID: {tx['id']}, Date: {tx['date']}, Amount: {tx['amount']}, "
                  f"Description: {tx['description']}, Status: {tx['status']}")
        
        return recurrence_txs
    
    def edit_recurrence(self, amount, description, edit_number):
        """Edit the recurrence (change amount and description)"""
        print(f"\n=== STEP 6.{edit_number}: Edit Recurrence (Attempt #{edit_number}) ===")
        
        # First get the current recurrence to preserve next_run
        response = requests.get(f"{BASE_URL}/recurrences", headers=self.headers)
        assert response.status_code == 200, f"Get recurrences failed: {response.text}"
        recurrences = response.json()
        current_rec = next((r for r in recurrences if r["id"] == self.recurrence_id), None)
        assert current_rec is not None, "Recurrence not found"
        
        payload = {
            "type": current_rec["type"],
            "amount": amount,
            "frequency": current_rec["frequency"],
            "next_run": current_rec["next_run"],
            "description": description,
            "account_id": current_rec.get("account_id"),
            "category_id": current_rec.get("category_id"),
            "payment_method": current_rec.get("payment_method"),
            "active": current_rec.get("active", True)
        }
        
        response = requests.put(
            f"{BASE_URL}/recurrences/{self.recurrence_id}",
            headers=self.headers,
            json=payload
        )
        assert response.status_code == 200, f"Edit recurrence failed: {response.text}"
        data = response.json()
        print(f"✓ Recurrence edited:")
        print(f"  - New Amount: {data['amount']}")
        print(f"  - New Description: {data['description']}")
        return data
    
    def verify_no_duplicates(self, initial_count):
        """Verify that the count hasn't increased (no duplicates)"""
        print("\n=== STEP 7: Verify No Duplicates ===")
        
        current_txs = self.count_recurrence_transactions()
        current_count = len(current_txs)
        
        print(f"\n📊 DUPLICATE CHECK:")
        print(f"  - Initial count: {initial_count}")
        print(f"  - Current count: {current_count}")
        
        if current_count > initial_count:
            print(f"❌ FAILED: Transactions were DUPLICATED! Count increased by {current_count - initial_count}")
            return False
        else:
            print(f"✓ PASSED: No duplicates. Count remains {current_count}")
            return True
    
    def verify_pending_updated(self, expected_amount, expected_description):
        """Verify that pending transactions were updated with new values"""
        print("\n=== STEP 8: Verify Pending Transactions Updated ===")
        
        current_txs = self.count_recurrence_transactions()
        
        pending_txs = [tx for tx in current_txs if tx["status"] == "pending"]
        paid_txs = [tx for tx in current_txs if tx["status"] == "paid"]
        
        print(f"\n📊 TRANSACTION STATUS:")
        print(f"  - Pending: {len(pending_txs)}")
        print(f"  - Paid: {len(paid_txs)}")
        
        all_pending_updated = True
        for tx in pending_txs:
            if tx["amount"] != expected_amount or tx["description"] != expected_description:
                print(f"❌ Pending transaction NOT updated: ID={tx['id']}, "
                      f"Amount={tx['amount']} (expected {expected_amount}), "
                      f"Description={tx['description']} (expected {expected_description})")
                all_pending_updated = False
            else:
                print(f"✓ Pending transaction updated: ID={tx['id']}, "
                      f"Amount={tx['amount']}, Description={tx['description']}")
        
        if all_pending_updated and len(pending_txs) > 0:
            print(f"\n✓ PASSED: All {len(pending_txs)} pending transactions updated correctly")
        elif len(pending_txs) == 0:
            print(f"\n⚠ WARNING: No pending transactions found (all might be paid/today)")
        else:
            print(f"\n❌ FAILED: Some pending transactions were NOT updated")
        
        return all_pending_updated
    
    def test_idempotency(self):
        """Test idempotency by calling GET /transactions again"""
        print("\n=== STEP 9: Test Idempotency (Re-query Transactions) ===")
        
        count_before = len(self.count_recurrence_transactions())
        
        # Re-query the same months (this triggers materialize_recurrences again)
        self.materialize_transactions(months_ahead=2)
        
        count_after = len(self.count_recurrence_transactions())
        
        print(f"\n📊 IDEMPOTENCY CHECK:")
        print(f"  - Count before re-query: {count_before}")
        print(f"  - Count after re-query: {count_after}")
        
        if count_after > count_before:
            print(f"❌ FAILED: Re-querying created {count_after - count_before} duplicate(s)")
            return False
        else:
            print(f"✓ PASSED: Idempotent. No duplicates created on re-query")
            return True
    
    def test_edit_next_run_to_materialized_date(self):
        """Test editing next_run to an already-materialized date (shouldn't duplicate)"""
        print("\n=== STEP 10: Test Editing next_run to Already-Materialized Date ===")
        
        # Get current recurrence
        response = requests.get(f"{BASE_URL}/recurrences", headers=self.headers)
        assert response.status_code == 200
        recurrences = response.json()
        current_rec = next((r for r in recurrences if r["id"] == self.recurrence_id), None)
        
        # Get the initial next_run (should be today's date)
        initial_next_run = date.today().isoformat()
        
        count_before = len(self.count_recurrence_transactions())
        
        # Edit next_run back to today (already materialized)
        payload = {
            "type": current_rec["type"],
            "amount": current_rec["amount"],
            "frequency": current_rec["frequency"],
            "next_run": initial_next_run,  # Back to today
            "description": current_rec["description"],
            "account_id": current_rec.get("account_id"),
            "category_id": current_rec.get("category_id"),
            "payment_method": current_rec.get("payment_method"),
            "active": current_rec.get("active", True)
        }
        
        response = requests.put(
            f"{BASE_URL}/recurrences/{self.recurrence_id}",
            headers=self.headers,
            json=payload
        )
        assert response.status_code == 200
        print(f"✓ Edited next_run back to {initial_next_run}")
        
        # Query current month again (triggers materialization)
        today = date.today()
        response = requests.get(
            f"{BASE_URL}/transactions",
            headers=self.headers,
            params={"year": today.year, "month": today.month}
        )
        assert response.status_code == 200
        
        count_after = len(self.count_recurrence_transactions())
        
        print(f"\n📊 NEXT_RUN EDIT CHECK:")
        print(f"  - Count before editing next_run: {count_before}")
        print(f"  - Count after editing next_run: {count_after}")
        
        if count_after > count_before:
            print(f"❌ FAILED: Editing next_run created {count_after - count_before} duplicate(s)")
            return False
        else:
            print(f"✓ PASSED: No duplicates when editing next_run to already-materialized date")
            return True
    
    def run_full_test(self):
        """Run the complete test scenario"""
        print("=" * 80)
        print("TESTING: Recurrence Edit Bug Fix - No Duplicates")
        print("=" * 80)
        
        try:
            # Login
            self.login()
            
            # Get account
            self.get_account()
            
            # Create recurrence
            self.create_monthly_recurrence()
            
            # Materialize transactions
            self.materialize_transactions(months_ahead=2)
            
            # Count initial transactions
            initial_txs = self.count_recurrence_transactions()
            initial_count = len(initial_txs)
            
            # Edit recurrence multiple times (2-3 times as requested)
            self.edit_recurrence(amount=250.0, description="Assinatura Y", edit_number=1)
            self.edit_recurrence(amount=250.0, description="Assinatura Y", edit_number=2)
            self.edit_recurrence(amount=250.0, description="Assinatura Y", edit_number=3)
            
            # Verify no duplicates
            no_duplicates = self.verify_no_duplicates(initial_count)
            
            # Verify pending transactions updated
            pending_updated = self.verify_pending_updated(
                expected_amount=250.0,
                expected_description="Assinatura Y"
            )
            
            # Test idempotency
            idempotent = self.test_idempotency()
            
            # Test editing next_run to already-materialized date
            next_run_ok = self.test_edit_next_run_to_materialized_date()
            
            # Final summary
            print("\n" + "=" * 80)
            print("FINAL TEST RESULTS")
            print("=" * 80)
            print(f"✓ No Duplicates After Edits: {'PASSED' if no_duplicates else 'FAILED'}")
            print(f"✓ Pending Transactions Updated: {'PASSED' if pending_updated else 'FAILED'}")
            print(f"✓ Idempotency (Re-query): {'PASSED' if idempotent else 'FAILED'}")
            print(f"✓ Edit next_run (No Duplicate): {'PASSED' if next_run_ok else 'FAILED'}")
            
            all_passed = no_duplicates and pending_updated and idempotent and next_run_ok
            
            if all_passed:
                print("\n🎉 ALL TESTS PASSED - BUG FIX VERIFIED")
            else:
                print("\n❌ SOME TESTS FAILED - BUG FIX NOT WORKING CORRECTLY")
            
            print("=" * 80)
            
            return all_passed
            
        except AssertionError as e:
            print(f"\n❌ TEST FAILED: {e}")
            return False
        except Exception as e:
            print(f"\n❌ UNEXPECTED ERROR: {e}")
            import traceback
            traceback.print_exc()
            return False


if __name__ == "__main__":
    test = TestRecurrenceEditBugFix()
    success = test.run_full_test()
    exit(0 if success else 1)
