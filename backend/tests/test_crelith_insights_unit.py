import importlib
import os
import sys
from datetime import date
from pathlib import Path


os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aura_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
server = importlib.import_module("server")


def item(
    item_id,
    item_type,
    amount,
    day,
    *,
    category_id=None,
    account_id="wallet-1",
    description="",
    recurrence_id=None,
):
    return {
        "id": item_id,
        "type": item_type,
        "base_amount": amount,
        "date": day,
        "category_id": category_id,
        "account_id": account_id,
        "description": description,
        "recurrence_id": recurrence_id,
    }


def build(**overrides):
    values = {
        "today": date(2026, 7, 28),
        "currency": "EUR",
        "current_items": [],
        "previous_items": [],
        "categories": [{"id": "food", "name": "Alimentação"}],
        "current_balance": 1000,
        "future_cashflows": [],
        "overdue_settlements": 0,
        "hidden_ids": set(),
    }
    values.update(overrides)
    return server.build_crelith_insights(**values)


def test_detects_category_growth_using_comparable_periods():
    current = [
        item("salary", "income", 2000, "2026-07-05"),
        item("food-1", "expense", 80, "2026-07-10", category_id="food"),
        item("food-2", "expense", 70, "2026-07-20", category_id="food"),
    ]
    previous = [
        item("old-food", "expense", 100, "2026-06-15", category_id="food"),
    ]

    insights = build(current_items=current, previous_items=previous)
    growth = next(row for row in insights if row["code"] == "category_growth")

    assert growth["data"]["category"] == "Alimentação"
    assert growth["data"]["percent"] == 50.0
    assert growth["action_path"].startswith("/lancamentos?")


def test_forecast_reports_exact_first_negative_day():
    insights = build(
        current_balance=100,
        future_cashflows=[
            item("rent", "expense", 70, "2026-07-29", description="Aluguel"),
            item("energy", "expense", 50, "2026-07-30", description="Energia"),
        ],
    )
    forecast = next(
        row for row in insights if row["code"] == "negative_balance_forecast"
    )

    assert forecast["severity"] == "critical"
    assert forecast["data"]["date"] == "2026-07-30"
    assert forecast["data"]["projected_balance"] == -20


def test_detects_upcoming_recurrence_duplicate_and_old_settlement():
    current = [
        item("a", "expense", 25, "2026-07-20", description="Mercado"),
        item("b", "expense", 25, "2026-07-20", description="Mercado"),
    ]
    future = [
        item(
            "netflix",
            "expense",
            12.9,
            "2026-07-30",
            description="Netflix",
            recurrence_id="rec-netflix",
        ),
    ]

    codes = {
        row["code"] for row in build(
            current_items=current,
            future_cashflows=future,
            overdue_settlements=2,
        )
    }

    assert {"recurrence_due", "possible_duplicate", "overdue_settlements"} <= codes


def test_hidden_instance_is_not_replaced_by_false_insufficient_data():
    hidden_id = "month_covered:2026-07"
    insights = build(
        current_balance=100,
        future_cashflows=[
            item("bill", "expense", 20, "2026-07-30", description="Conta"),
        ],
        hidden_ids={hidden_id},
    )

    assert insights == []


def test_requires_minimum_history_for_category_growth():
    insights = build(
        current_items=[
            item("one", "expense", 200, "2026-07-20", category_id="food"),
        ],
        previous_items=[
            item("old", "expense", 50, "2026-06-20", category_id="food"),
        ],
    )

    assert all(row["code"] != "category_growth" for row in insights)
