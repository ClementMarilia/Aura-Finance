#!/usr/bin/env python3
"""
Backend API Test Suite for Aurea Finance App
Testing: Password Recovery via Security Question Feature
"""

import requests
import json
import sys
from datetime import datetime

# Configuration
BASE_URL = "https://analyze-code-20.preview.emergentagent.com/api"

# Test credentials
MARILIA_EMAIL = "marilia@demo.com"
MARILIA_PASSWORD_ORIGINAL = "demo123"
MARILIA_PASSWORD_NEW = "nova123"

WENDY_EMAIL = "wendy@demo.com"
WENDY_PASSWORD = "demo123"

# Security question data
SECURITY_QUESTION = "Qual o nome do seu primeiro animal de estimação?"
SECURITY_ANSWER = "Rex"

# Colors for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def log_test(step, message, status="INFO"):
    color = BLUE if status == "INFO" else GREEN if status == "PASS" else RED if status == "FAIL" else YELLOW
    print(f"{color}[{status}] Step {step}: {message}{RESET}")

def log_detail(message):
    print(f"  → {message}")

def test_step_1_login_marilia():
    """Step 1: Login marilia@demo.com / demo123 → Bearer token"""
    log_test(1, "Login marilia@demo.com with original password", "INFO")
    
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": MARILIA_EMAIL, "password": MARILIA_PASSWORD_ORIGINAL}
    )
    
    if response.status_code == 200:
        data = response.json()
        token = data.get("token")
        if token:
            log_test(1, f"Login successful, token received", "PASS")
            log_detail(f"User: {data.get('user', {}).get('name')}")
            return token
        else:
            log_test(1, "Login response missing token", "FAIL")
            return None
    else:
        log_test(1, f"Login failed: {response.status_code} - {response.text}", "FAIL")
        return None

def test_step_2_set_security_question(token):
    """Step 2: Set security question via POST /auth/security-question"""
    log_test(2, "Set security question and answer", "INFO")
    
    response = requests.post(
        f"{BASE_URL}/auth/security-question",
        headers={"Authorization": f"Bearer {token}"},
        json={"question": SECURITY_QUESTION, "answer": SECURITY_ANSWER}
    )
    
    if response.status_code == 200:
        log_test(2, "Security question set successfully", "PASS")
        log_detail(f"Question: {SECURITY_QUESTION}")
        log_detail(f"Answer: {SECURITY_ANSWER}")
        return True
    else:
        log_test(2, f"Failed to set security question: {response.status_code} - {response.text}", "FAIL")
        return False

def test_step_3_verify_has_security_question(token):
    """Step 3: GET /auth/me should show has_security_question=true"""
    log_test(3, "Verify /auth/me shows has_security_question=true", "INFO")
    
    response = requests.get(
        f"{BASE_URL}/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        has_security_question = data.get("has_security_question")
        security_question = data.get("security_question")
        
        if has_security_question == True and security_question == SECURITY_QUESTION:
            log_test(3, "Security question correctly reflected in /auth/me", "PASS")
            log_detail(f"has_security_question: {has_security_question}")
            log_detail(f"security_question: {security_question}")
            return True
        else:
            log_test(3, f"Security question not properly set. has_security_question={has_security_question}, question={security_question}", "FAIL")
            return False
    else:
        log_test(3, f"Failed to get /auth/me: {response.status_code} - {response.text}", "FAIL")
        return False

def test_step_4_get_security_question_existing():
    """Step 4: GET /auth/security-question?email=marilia@demo.com (no auth) → returns question"""
    log_test(4, "Get security question for existing user (public endpoint)", "INFO")
    
    response = requests.get(
        f"{BASE_URL}/auth/security-question",
        params={"email": MARILIA_EMAIL}
    )
    
    if response.status_code == 200:
        data = response.json()
        question = data.get("question")
        
        if question == SECURITY_QUESTION:
            log_test(4, "Security question retrieved successfully", "PASS")
            log_detail(f"Question: {question}")
            return True
        else:
            log_test(4, f"Unexpected question returned: {question}", "FAIL")
            return False
    else:
        log_test(4, f"Failed to get security question: {response.status_code} - {response.text}", "FAIL")
        return False

def test_step_5_get_security_question_nonexistent():
    """Step 5: GET /auth/security-question?email=naoexiste@demo.com → returns {question: null}"""
    log_test(5, "Get security question for non-existent user", "INFO")
    
    response = requests.get(
        f"{BASE_URL}/auth/security-question",
        params={"email": "naoexiste@demo.com"}
    )
    
    if response.status_code == 200:
        data = response.json()
        question = data.get("question")
        
        if question is None:
            log_test(5, "Correctly returns null for non-existent user (no info leak)", "PASS")
            log_detail(f"Response: {data}")
            return True
        else:
            log_test(5, f"Should return null but got: {question}", "FAIL")
            return False
    else:
        log_test(5, f"Unexpected status code: {response.status_code} - {response.text}", "FAIL")
        return False

def test_step_6_reset_wrong_answer():
    """Step 6: Reset with WRONG answer → 400"""
    log_test(6, "Reset password with WRONG security answer", "INFO")
    
    response = requests.post(
        f"{BASE_URL}/auth/reset-password-security",
        json={
            "email": MARILIA_EMAIL,
            "answer": "errado",
            "new_password": MARILIA_PASSWORD_NEW
        }
    )
    
    if response.status_code == 400:
        log_test(6, "Correctly rejected wrong answer with 400", "PASS")
        log_detail(f"Error message: {response.json().get('detail')}")
        return True
    else:
        log_test(6, f"Expected 400 but got {response.status_code}", "FAIL")
        return False

def test_step_7_reset_correct_answer_case_insensitive():
    """Step 7: Reset with CORRECT answer (case-insensitive, with spaces) → 200"""
    log_test(7, "Reset password with correct answer (case-insensitive: ' REX ')", "INFO")
    
    response = requests.post(
        f"{BASE_URL}/auth/reset-password-security",
        json={
            "email": MARILIA_EMAIL,
            "answer": " REX ",  # Case-insensitive and with spaces
            "new_password": MARILIA_PASSWORD_NEW
        }
    )
    
    if response.status_code == 200:
        log_test(7, "Password reset successful with case-insensitive answer", "PASS")
        log_detail(f"Answer used: ' REX ' (with spaces and uppercase)")
        return True
    else:
        log_test(7, f"Password reset failed: {response.status_code} - {response.text}", "FAIL")
        return False

def test_step_8_confirm_password_change():
    """Step 8: Confirm password change - new password works, old password fails"""
    log_test(8, "Confirm password change", "INFO")
    
    # Test 8a: Login with NEW password should work
    log_detail("8a: Testing login with NEW password (nova123)")
    response_new = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": MARILIA_EMAIL, "password": MARILIA_PASSWORD_NEW}
    )
    
    # Test 8b: Login with OLD password should fail
    log_detail("8b: Testing login with OLD password (demo123)")
    response_old = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": MARILIA_EMAIL, "password": MARILIA_PASSWORD_ORIGINAL}
    )
    
    success_new = response_new.status_code == 200
    fail_old = response_old.status_code == 401
    
    if success_new and fail_old:
        log_test(8, "Password change confirmed: new password works, old password rejected", "PASS")
        log_detail(f"New password login: {response_new.status_code}")
        log_detail(f"Old password login: {response_old.status_code}")
        return response_new.json().get("token")  # Return token for next steps
    else:
        log_test(8, f"Password change verification failed. New: {response_new.status_code}, Old: {response_old.status_code}", "FAIL")
        return None

def test_step_9_account_without_security_question():
    """Step 9: Test account without security question configured"""
    log_test(9, "Test account without security question", "INFO")
    
    # Create a new test user
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    test_email = f"teste+{timestamp}@demo.com"
    test_password = "1234"
    
    log_detail(f"9a: Creating new user: {test_email}")
    response_register = requests.post(
        f"{BASE_URL}/auth/register",
        json={
            "name": "Test User",
            "email": test_email,
            "password": test_password,
            "currency": "EUR"
        }
    )
    
    if response_register.status_code != 200:
        log_test(9, f"Failed to create test user: {response_register.status_code}", "FAIL")
        return False
    
    log_detail(f"User created successfully")
    
    # Test 9b: GET security question should return null
    log_detail(f"9b: GET security question for user without question")
    response_get = requests.get(
        f"{BASE_URL}/auth/security-question",
        params={"email": test_email}
    )
    
    if response_get.status_code != 200 or response_get.json().get("question") is not None:
        log_test(9, f"GET security question should return null: {response_get.json()}", "FAIL")
        return False
    
    log_detail(f"Correctly returns question: null")
    
    # Test 9c: Try to reset password without security question → 400
    log_detail(f"9c: Try to reset password without security question configured")
    response_reset = requests.post(
        f"{BASE_URL}/auth/reset-password-security",
        json={
            "email": test_email,
            "answer": "x",
            "new_password": "y123"
        }
    )
    
    if response_reset.status_code == 400:
        error_msg = response_reset.json().get("detail", "")
        if "não disponível" in error_msg.lower() or "not available" in error_msg.lower():
            log_test(9, "Correctly rejected reset for account without security question", "PASS")
            log_detail(f"Error message: {error_msg}")
            return True
        else:
            log_test(9, f"Got 400 but unexpected error message: {error_msg}", "FAIL")
            return False
    else:
        log_test(9, f"Expected 400 but got {response_reset.status_code}", "FAIL")
        return False

def test_step_10_restore_password():
    """Step 10: RESTORE marilia's password back to demo123"""
    log_test(10, "RESTORE marilia's password to original (demo123)", "INFO")
    
    # Use the reset flow to restore password
    log_detail("10a: Using reset flow to restore password")
    response_reset = requests.post(
        f"{BASE_URL}/auth/reset-password-security",
        json={
            "email": MARILIA_EMAIL,
            "answer": " REX ",  # Case-insensitive
            "new_password": MARILIA_PASSWORD_ORIGINAL
        }
    )
    
    if response_reset.status_code != 200:
        log_test(10, f"Failed to reset password back: {response_reset.status_code} - {response_reset.text}", "FAIL")
        return False
    
    log_detail("Password reset to original successful")
    
    # Confirm by logging in with original password
    log_detail("10b: Confirming login with restored password (demo123)")
    response_login = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": MARILIA_EMAIL, "password": MARILIA_PASSWORD_ORIGINAL}
    )
    
    if response_login.status_code == 200:
        log_test(10, "Password successfully restored to demo123", "PASS")
        log_detail(f"Login confirmed with original password")
        return True
    else:
        log_test(10, f"Failed to login with restored password: {response_login.status_code}", "FAIL")
        return False

def main():
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}Backend API Test: Password Recovery via Security Question{RESET}")
    print(f"{BLUE}App: Aurea Finance | Base URL: {BASE_URL}{RESET}")
    print(f"{BLUE}{'='*80}{RESET}\n")
    
    results = []
    
    # Step 1: Login marilia
    token = test_step_1_login_marilia()
    results.append(("Step 1: Login marilia", token is not None))
    if not token:
        print(f"\n{RED}CRITICAL: Cannot proceed without login token{RESET}")
        sys.exit(1)
    
    print()
    
    # Step 2: Set security question
    result = test_step_2_set_security_question(token)
    results.append(("Step 2: Set security question", result))
    print()
    
    # Step 3: Verify has_security_question in /auth/me
    result = test_step_3_verify_has_security_question(token)
    results.append(("Step 3: Verify /auth/me", result))
    print()
    
    # Step 4: Get security question for existing user
    result = test_step_4_get_security_question_existing()
    results.append(("Step 4: Get security question (existing)", result))
    print()
    
    # Step 5: Get security question for non-existent user
    result = test_step_5_get_security_question_nonexistent()
    results.append(("Step 5: Get security question (non-existent)", result))
    print()
    
    # Step 6: Reset with wrong answer
    result = test_step_6_reset_wrong_answer()
    results.append(("Step 6: Reset with wrong answer", result))
    print()
    
    # Step 7: Reset with correct answer (case-insensitive)
    result = test_step_7_reset_correct_answer_case_insensitive()
    results.append(("Step 7: Reset with correct answer", result))
    print()
    
    # Step 8: Confirm password change
    new_token = test_step_8_confirm_password_change()
    results.append(("Step 8: Confirm password change", new_token is not None))
    print()
    
    # Step 9: Account without security question
    result = test_step_9_account_without_security_question()
    results.append(("Step 9: Account without security question", result))
    print()
    
    # Step 10: RESTORE password
    result = test_step_10_restore_password()
    results.append(("Step 10: RESTORE password", result))
    print()
    
    # Summary
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}TEST SUMMARY{RESET}")
    print(f"{BLUE}{'='*80}{RESET}\n")
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for step_name, result in results:
        status = f"{GREEN}✓ PASS{RESET}" if result else f"{RED}✗ FAIL{RESET}"
        print(f"{status} - {step_name}")
    
    print(f"\n{BLUE}{'='*80}{RESET}")
    if passed == total:
        print(f"{GREEN}ALL TESTS PASSED: {passed}/{total}{RESET}")
        print(f"{BLUE}{'='*80}{RESET}\n")
        sys.exit(0)
    else:
        print(f"{RED}SOME TESTS FAILED: {passed}/{total} passed{RESET}")
        print(f"{BLUE}{'='*80}{RESET}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
