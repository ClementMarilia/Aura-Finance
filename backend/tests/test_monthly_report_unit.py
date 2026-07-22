import importlib
import os
import sys
from pathlib import Path


os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aura_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
server = importlib.import_module("server")


def test_monthly_report_summary_and_expense_profile():
    categories = [
        {"id": "salary", "name": "Salário", "color": "#2C7A51"},
        {"id": "food", "name": "Mercado", "color": "#D96C5B"},
        {"id": "home", "name": "Moradia", "color": "#1E3F33"},
    ]
    items = [
        {
            "id": "income-1", "type": "income", "date": "2026-07-15",
            "amount": 1000, "currency": "EUR", "status": "paid",
            "category_id": "salary", "description": "Salário",
        },
        {
            "id": "expense-1", "type": "expense", "date": "2026-07-18",
            "amount": 100, "currency": "EUR", "status": "paid",
            "category_id": "food", "description": "Mercado",
        },
        {
            "id": "expense-2", "type": "expense", "date": "2026-07-10",
            "amount": 100, "currency": "USD", "status": "paid",
            "exchange_rates": {"USD": 1, "EUR": 0.9},
            "category_id": "home", "description": "Internet",
            "recurrence_id": "rec-1", "source": "recurrence",
        },
        {
            "id": "installment-1", "type": "expense", "date": "2026-07-25",
            "amount": 50, "currency": "EUR", "status": "pending",
            "category_id": "food", "description": "Compra parcelada",
            "source": "installment", "installment_number": 2, "installment_total": 4,
        },
    ]

    report = server.build_monthly_report(2026, 7, items, categories, "EUR")

    assert report["summary"] == {
        "income": 1000.0,
        "expense": 240.0,
        "balance": 760.0,
        "balance_status": "positive",
        "paid_income": 1000.0,
        "paid_expense": 190.0,
        "pending_income": 0,
        "pending_expense": 50.0,
        "realized_balance": 810.0,
        "savings_rate": 76.0,
        "transaction_count": 4,
    }
    assert report["expense_profile"] == {
        "fixed": 90.0,
        "variable": 100.0,
        "installments": 50.0,
    }
    assert report["largest_expense"]["id"] == "expense-1"
    assert report["top_category"]["category"] == "Mercado"
    assert report["top_category"]["amount"] == 150.0
    assert report["expenses"][0]["id"] == "installment-1"


def test_change_percent_handles_zero_and_negative_values():
    assert server._change_percent(100, 0) == 100.0
    assert server._change_percent(0, 0) is None
    assert server._change_percent(-50, -100) == 50.0
