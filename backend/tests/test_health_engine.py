import pytest

from services.financial.health_engine import build_health_score, configured_rules


def build(**overrides):
    values = {
        "current_balance": 3000,
        "projected_balance": 2500,
        "monthly_income": 3000,
        "monthly_expense": 1800,
        "average_monthly_expense": 1000,
        "goals": [{"target_amount": 1000, "current_amount": 1000}],
        "overdue_count": 0,
        "overdue_amount": 0,
        "overspending_categories": [],
        "currency": "EUR",
    }
    values.update(overrides)
    return build_health_score(**values)


def test_healthy_finances_reach_full_score_with_auditable_factors():
    result = build()

    assert result["score"] == 100
    assert result["level"] == "excellent"
    assert result["confidence"] == 100
    assert sum(item["weight"] for item in result["factors"]) == 100
    assert all("evidence" in item and "points" in item for item in result["factors"])


def test_risk_signals_reduce_score_without_leaving_zero_to_hundred_range():
    result = build(
        current_balance=-100,
        projected_balance=-500,
        monthly_expense=3600,
        goals=[{"target_amount": 1000, "current_amount": 0}],
        overdue_count=4,
        overdue_amount=400,
        overspending_categories=[{"category": "Moradia"}, {"category": "Lazer"}],
    )

    assert 0 <= result["score"] < 45
    assert result["level"] == "critical"
    factor_map = {item["code"]: item for item in result["factors"]}
    assert factor_map["positive_balance"]["points"] == 0
    assert factor_map["overdue_bills"]["evidence"]["overdue_count"] == 4


def test_missing_history_is_neutral_and_explicit_instead_of_silently_punitive():
    result = build(
        monthly_income=0,
        monthly_expense=0,
        average_monthly_expense=None,
        goals=[],
    )

    unavailable = [item for item in result["factors"] if not item["available"]]
    assert {item["code"] for item in unavailable} == {
        "emergency_reserve", "goals_progress", "budget_adherence", "monthly_savings",
    }
    assert result["confidence"] == 45
    assert all(item["points"] == item["weight"] / 2 for item in unavailable)


def test_server_side_rules_are_configurable_and_reject_negative_weights():
    rules = configured_rules({
        "monthly_savings": {"weight": 25, "good_threshold": 30},
        "positive_balance": {"weight": 5},
    })
    savings = next(item for item in rules if item.code == "monthly_savings")
    assert savings.weight == 25
    assert savings.good_threshold == 30

    with pytest.raises(ValueError):
        configured_rules({"positive_balance": {"weight": -1}})

    with pytest.raises(ValueError):
        configured_rules({"positive_balance": {"weight": 16}})

    with pytest.raises(ValueError):
        configured_rules({
            "budget_adherence": {"good_threshold": 100},
        })


def test_category_rule_is_neutral_when_no_comparable_history_exists():
    result = build(category_comparison_available=False)
    factor = next(item for item in result["factors"] if item["code"] == "category_overspending")

    assert factor["status"] == "unavailable"
    assert factor["points"] == 5
