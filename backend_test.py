#!/usr/bin/env python3
"""
Backend test for Categories by kind (expense/income/both) feature.
Tests ONLY the backend API endpoints.
"""

import requests
import sys
from typing import Dict, List, Optional

# Base URL from frontend/.env
BASE_URL = "https://de950129-d299-4610-b5f7-32045bdb977b.preview.emergentagent.com/api"

# Test credentials
WENDY_EMAIL = "wendy@demo.com"
WENDY_PASSWORD = "demo123"
MARILIA_EMAIL = "marilia@demo.com"
MARILIA_PASSWORD = "demo123"

# Expected default income categories
EXPECTED_INCOME_CATEGORIES = [
    "Salário",
    "Freelance / Extra",
    "Investimentos",
    "Presente / Reembolso",
    "Outras receitas"
]

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


def get_categories(token: str) -> Optional[List[Dict]]:
    """Get all categories for the authenticated user"""
    try:
        resp = requests.get(
            f"{BASE_URL}/categories",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"GET /categories failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"GET /categories error: {e}")
        return None


def create_category(token: str, name: str, color: str, kind: str) -> Optional[Dict]:
    """Create a new category"""
    try:
        resp = requests.post(
            f"{BASE_URL}/categories",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": name, "color": color, "kind": kind},
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"POST /categories failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"POST /categories error: {e}")
        return None


def update_category(token: str, category_id: str, name: str, color: str, kind: str) -> bool:
    """Update a category"""
    try:
        resp = requests.put(
            f"{BASE_URL}/categories/{category_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": name, "color": color, "kind": kind},
            timeout=10
        )
        return resp.status_code == 200
    except Exception as e:
        print(f"PUT /categories error: {e}")
        return False


def delete_category(token: str, category_id: str) -> bool:
    """Delete a category"""
    try:
        resp = requests.delete(
            f"{BASE_URL}/categories/{category_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        return resp.status_code == 200
    except Exception as e:
        print(f"DELETE /categories error: {e}")
        return False


def run_tests():
    result = TestResult()
    
    print("="*80)
    print("BACKEND TEST: Categories by kind (expense/income/both)")
    print("="*80)
    
    # Test 1: Login with wendy@demo.com
    print("\n[Test 1] Login with wendy@demo.com / demo123")
    wendy_token = login(WENDY_EMAIL, WENDY_PASSWORD)
    if wendy_token:
        result.add_pass("Test 1: Login wendy", f"Token received (length: {len(wendy_token)})")
        print(f"✓ Login successful, token: {wendy_token[:20]}...")
    else:
        result.add_fail("Test 1: Login wendy", "Failed to get token")
        print("✗ Login failed")
        result.print_summary()
        return False
    
    # Test 2: GET /categories - verify 5 default income categories
    print("\n[Test 2] GET /categories - verify 5 default income categories")
    categories = get_categories(wendy_token)
    if categories is None:
        result.add_fail("Test 2: GET /categories", "Failed to fetch categories")
        result.print_summary()
        return False
    
    print(f"Total categories: {len(categories)}")
    
    # Filter income categories
    income_cats = [c for c in categories if c.get("kind") == "income"]
    print(f"Income categories found: {len(income_cats)}")
    
    # Check for default income categories
    default_income_cats = [c for c in income_cats if c.get("is_default") == True]
    print(f"Default income categories: {len(default_income_cats)}")
    
    # Verify each expected income category exists
    found_names = [c["name"] for c in default_income_cats]
    print(f"Default income category names: {found_names}")
    
    missing = []
    for expected_name in EXPECTED_INCOME_CATEGORIES:
        if expected_name not in found_names:
            missing.append(expected_name)
    
    if len(default_income_cats) == 5 and len(missing) == 0:
        result.add_pass("Test 2: Default income categories", 
                       f"All 5 default income categories present: {', '.join(EXPECTED_INCOME_CATEGORIES)}")
        print("✓ All 5 default income categories found with kind='income' and is_default=true")
    else:
        result.add_fail("Test 2: Default income categories", 
                       f"Expected 5, found {len(default_income_cats)}. Missing: {missing}")
        print(f"✗ Expected 5 default income categories, found {len(default_income_cats)}")
        if missing:
            print(f"  Missing: {missing}")
    
    # Verify all have kind='income'
    wrong_kind = [c["name"] for c in default_income_cats if c.get("kind") != "income"]
    if wrong_kind:
        result.add_fail("Test 2: Income category kind", 
                       f"Categories with wrong kind: {wrong_kind}")
        print(f"✗ Some default income categories have wrong kind: {wrong_kind}")
    else:
        result.add_pass("Test 2: Income category kind", "All default income categories have kind='income'")
        print("✓ All default income categories have kind='income'")
    
    # Test 3: POST /categories with kind='expense' (Gasolina)
    print("\n[Test 3] POST /categories - create 'Gasolina' with kind='expense'")
    gasolina = create_category(wendy_token, "Gasolina", "#E5A83B", "expense")
    if gasolina and gasolina.get("kind") == "expense":
        result.add_pass("Test 3: Create expense category", 
                       f"Created 'Gasolina' with kind='expense', id={gasolina['id']}")
        print(f"✓ Created 'Gasolina' with kind='expense', id={gasolina['id']}")
        gasolina_id = gasolina["id"]
    else:
        result.add_fail("Test 3: Create expense category", 
                       f"Failed to create or wrong kind: {gasolina}")
        print(f"✗ Failed to create 'Gasolina' or wrong kind")
        gasolina_id = None
    
    # Test 4: POST /categories with kind='income' (13o Salario)
    print("\n[Test 4] POST /categories - create '13o Salario' with kind='income'")
    decimo = create_category(wendy_token, "13o Salario", "#2C7A51", "income")
    if decimo and decimo.get("kind") == "income":
        result.add_pass("Test 4: Create income category", 
                       f"Created '13o Salario' with kind='income', id={decimo['id']}")
        print(f"✓ Created '13o Salario' with kind='income', id={decimo['id']}")
        decimo_id = decimo["id"]
    else:
        result.add_fail("Test 4: Create income category", 
                       f"Failed to create or wrong kind: {decimo}")
        print(f"✗ Failed to create '13o Salario' or wrong kind")
        decimo_id = None
    
    # Verify new categories appear in GET /categories
    print("\n[Test 4b] Verify new categories appear in GET /categories")
    categories_after = get_categories(wendy_token)
    if categories_after:
        gasolina_found = any(c["id"] == gasolina_id for c in categories_after) if gasolina_id else False
        decimo_found = any(c["id"] == decimo_id for c in categories_after) if decimo_id else False
        
        if gasolina_found and decimo_found:
            result.add_pass("Test 4b: New categories in list", 
                           "Both new categories appear in GET /categories")
            print("✓ Both new categories appear in GET /categories")
        else:
            result.add_fail("Test 4b: New categories in list", 
                           f"Gasolina found: {gasolina_found}, 13o Salario found: {decimo_found}")
            print(f"✗ New categories not found in list")
    
    # Test 5: PUT /categories - change Gasolina kind to 'both'
    if gasolina_id:
        print("\n[Test 5] PUT /categories - change 'Gasolina' kind to 'both'")
        updated = update_category(wendy_token, gasolina_id, "Gasolina", "#E5A83B", "both")
        if updated:
            # Verify the change
            categories_updated = get_categories(wendy_token)
            gasolina_updated = next((c for c in categories_updated if c["id"] == gasolina_id), None)
            if gasolina_updated and gasolina_updated.get("kind") == "both":
                result.add_pass("Test 5: Update category kind", 
                               "Changed 'Gasolina' kind from 'expense' to 'both'")
                print("✓ Successfully changed 'Gasolina' kind to 'both'")
            else:
                result.add_fail("Test 5: Update category kind", 
                               f"Update returned 200 but kind not changed: {gasolina_updated}")
                print(f"✗ Update returned 200 but kind not changed")
        else:
            result.add_fail("Test 5: Update category kind", "PUT request failed")
            print("✗ PUT request failed")
    else:
        result.add_warning("Test 5: Update category kind", "Skipped (Gasolina not created)")
        print("⚠ Test 5 skipped (Gasolina not created)")
    
    # Test 6: DELETE /categories - delete 13o Salario
    if decimo_id:
        print("\n[Test 6] DELETE /categories - delete '13o Salario'")
        deleted = delete_category(wendy_token, decimo_id)
        if deleted:
            # Verify it's gone
            categories_after_delete = get_categories(wendy_token)
            decimo_still_exists = any(c["id"] == decimo_id for c in categories_after_delete)
            if not decimo_still_exists:
                result.add_pass("Test 6: Delete category", 
                               "Successfully deleted '13o Salario', verified it's gone")
                print("✓ Successfully deleted '13o Salario', verified it's gone")
            else:
                result.add_fail("Test 6: Delete category", 
                               "DELETE returned 200 but category still exists")
                print("✗ DELETE returned 200 but category still exists")
        else:
            result.add_fail("Test 6: Delete category", "DELETE request failed")
            print("✗ DELETE request failed")
    else:
        result.add_warning("Test 6: Delete category", "Skipped (13o Salario not created)")
        print("⚠ Test 6 skipped (13o Salario not created)")
    
    # Test 7: Idempotency - verify no duplicates of default income categories
    print("\n[Test 7] Idempotency - verify no duplicates of default income categories")
    categories_final = get_categories(wendy_token)
    if categories_final:
        # Count occurrences of each default income category name
        income_name_counts = {}
        for cat in categories_final:
            if cat.get("kind") == "income" and cat.get("is_default") == True:
                name = cat["name"]
                income_name_counts[name] = income_name_counts.get(name, 0) + 1
        
        duplicates = {name: count for name, count in income_name_counts.items() if count > 1}
        
        if not duplicates:
            result.add_pass("Test 7: Idempotency", 
                           f"No duplicates found. Each default income category appears exactly once: {income_name_counts}")
            print(f"✓ No duplicates found. Each default income category appears exactly once")
            print(f"  Counts: {income_name_counts}")
        else:
            result.add_fail("Test 7: Idempotency", 
                           f"Duplicates found: {duplicates}")
            print(f"✗ Duplicates found: {duplicates}")
    else:
        result.add_fail("Test 7: Idempotency", "Failed to fetch categories")
        print("✗ Failed to fetch categories for idempotency check")
    
    # Test 8: User isolation - verify wendy's categories don't appear for marilia
    print("\n[Test 8] User isolation - verify wendy's categories don't appear for marilia")
    marilia_token = login(MARILIA_EMAIL, MARILIA_PASSWORD)
    if marilia_token:
        result.add_pass("Test 8a: Login marilia", "Token received")
        print(f"✓ Login marilia successful")
        
        marilia_categories = get_categories(marilia_token)
        if marilia_categories is not None:
            # Check if Gasolina (wendy's custom category) appears in marilia's list
            gasolina_in_marilia = any(c.get("name") == "Gasolina" and c.get("id") == gasolina_id 
                                      for c in marilia_categories) if gasolina_id else False
            
            if not gasolina_in_marilia:
                result.add_pass("Test 8b: User isolation", 
                               "Wendy's custom 'Gasolina' category does NOT appear in Marilia's list")
                print("✓ User isolation verified: Wendy's custom categories don't appear for Marilia")
            else:
                result.add_fail("Test 8b: User isolation", 
                               "Wendy's 'Gasolina' category appears in Marilia's list")
                print("✗ User isolation FAILED: Wendy's categories appear for Marilia")
            
            # Verify marilia also has the 5 default income categories
            marilia_income_defaults = [c for c in marilia_categories 
                                      if c.get("kind") == "income" and c.get("is_default") == True]
            if len(marilia_income_defaults) == 5:
                result.add_pass("Test 8c: Marilia default categories", 
                               "Marilia also has 5 default income categories")
                print("✓ Marilia also has 5 default income categories")
            else:
                result.add_warning("Test 8c: Marilia default categories", 
                                  f"Expected 5, found {len(marilia_income_defaults)}")
                print(f"⚠ Marilia has {len(marilia_income_defaults)} default income categories (expected 5)")
        else:
            result.add_fail("Test 8b: User isolation", "Failed to fetch Marilia's categories")
            print("✗ Failed to fetch Marilia's categories")
    else:
        result.add_fail("Test 8a: Login marilia", "Failed to get token")
        print("✗ Login marilia failed")
    
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
