"""Deterministic and auditable financial-health scoring.

The engine is intentionally pure: database access, authentication and currency
conversion stay in the API layer.  Every rule receives normalized evidence and
returns both the earned points and the reason behind them.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Iterable, Mapping, Optional


@dataclass(frozen=True)
class HealthRule:
    code: str
    weight: float
    good_threshold: float
    warning_threshold: float


DEFAULT_RULES: tuple[HealthRule, ...] = (
    HealthRule("positive_balance", 15, 1, 0.01),
    HealthRule("emergency_reserve", 15, 3, 1),
    HealthRule("goals_progress", 10, 80, 40),
    HealthRule("budget_adherence", 15, 80, 100),
    HealthRule("monthly_savings", 15, 20, 5),
    HealthRule("overdue_bills", 10, 0, 1),
    HealthRule("category_overspending", 10, 0, 1),
    HealthRule("projected_balance", 10, 0.01, 0),
)


def configured_rules(overrides: Optional[Mapping[str, Mapping[str, float]]] = None) -> tuple[HealthRule, ...]:
    """Return validated rules with optional server-side overrides.

    Keeping configuration outside request data prevents a client from choosing
    its own score while still allowing thresholds and weights to evolve without
    rewriting the calculation.
    """
    overrides = overrides or {}
    rules = []
    for rule in DEFAULT_RULES:
        values = overrides.get(rule.code, {})
        updated = replace(
            rule,
            weight=float(values.get("weight", rule.weight)),
            good_threshold=float(values.get("good_threshold", rule.good_threshold)),
            warning_threshold=float(values.get("warning_threshold", rule.warning_threshold)),
        )
        if updated.weight < 0:
            raise ValueError(f"Negative weight for {updated.code}")
        rules.append(updated)
    if not rules or round(sum(rule.weight for rule in rules), 6) != 100:
        raise ValueError("Financial health rule weights must total 100")
    rule_map = {rule.code: rule for rule in rules}
    for code in ("emergency_reserve", "goals_progress", "monthly_savings"):
        if rule_map[code].good_threshold <= 0:
            raise ValueError(f"Positive target required for {code}")
    if rule_map["budget_adherence"].warning_threshold <= rule_map["budget_adherence"].good_threshold:
        raise ValueError("Budget warning threshold must exceed its good threshold")
    for code in ("positive_balance", "projected_balance"):
        if rule_map[code].good_threshold < rule_map[code].warning_threshold:
            raise ValueError(f"Good threshold must be at least the warning threshold for {code}")
    for code in ("overdue_bills", "category_overspending"):
        if rule_map[code].warning_threshold < max(rule_map[code].good_threshold, 1):
            raise ValueError(f"Invalid count thresholds for {code}")
    return tuple(rules)


def _clamp(value: float, minimum: float = 0, maximum: float = 1) -> float:
    return max(minimum, min(maximum, float(value)))


def _factor(
    rule: HealthRule,
    ratio: Optional[float],
    *,
    status: str,
    evidence: Mapping[str, object],
) -> dict:
    available = ratio is not None
    # Missing history is neutral, never silently positive or punitive.
    normalized = 0.5 if ratio is None else _clamp(ratio)
    return {
        "code": rule.code,
        "weight": round(rule.weight, 2),
        "points": round(rule.weight * normalized, 2),
        "status": "unavailable" if not available else status,
        "available": available,
        "evidence": dict(evidence),
        "thresholds": {
            "good": rule.good_threshold,
            "warning": rule.warning_threshold,
        },
    }


def _status(ratio: float) -> str:
    if ratio >= 0.8:
        return "good"
    if ratio >= 0.4:
        return "warning"
    return "critical"


def _higher_is_better(value: float, rule: HealthRule) -> float:
    if value >= rule.good_threshold:
        return 1.0
    if value >= rule.warning_threshold:
        return 0.5
    return 0.0


def _lower_count_is_better(value: int, rule: HealthRule) -> float:
    if value <= rule.good_threshold:
        return 1.0
    if value <= rule.warning_threshold:
        return 0.5
    step = max(rule.warning_threshold, 1)
    return _clamp(0.5 - ((value - rule.warning_threshold) / step) * 0.25)


def build_health_score(
    *,
    current_balance: float,
    projected_balance: float,
    monthly_income: float,
    monthly_expense: float,
    average_monthly_expense: Optional[float],
    goals: Iterable[dict],
    overdue_count: int,
    overdue_amount: float,
    overspending_categories: Iterable[dict],
    category_comparison_available: bool = True,
    currency: str,
    rule_overrides: Optional[Mapping[str, Mapping[str, float]]] = None,
) -> dict:
    rules = {rule.code: rule for rule in configured_rules(rule_overrides)}
    factors = []

    balance_ratio = _higher_is_better(current_balance, rules["positive_balance"])
    factors.append(_factor(
        rules["positive_balance"], balance_ratio, status=_status(balance_ratio),
        evidence={"current_balance": round(current_balance, 2)},
    ))

    if average_monthly_expense and average_monthly_expense > 0:
        reserve_months = max(current_balance, 0) / average_monthly_expense
        reserve_ratio = _clamp(reserve_months / rules["emergency_reserve"].good_threshold)
    else:
        reserve_months = None
        reserve_ratio = None
    factors.append(_factor(
        rules["emergency_reserve"], reserve_ratio,
        status=_status(reserve_ratio or 0),
        evidence={
            "reserve_months": None if reserve_months is None else round(reserve_months, 2),
            "average_monthly_expense": None if average_monthly_expense is None else round(average_monthly_expense, 2),
        },
    ))

    valid_goals = [goal for goal in goals if float(goal.get("target_amount") or 0) > 0]
    if valid_goals:
        goal_progress = sum(
            _clamp(float(goal.get("current_amount") or 0) / float(goal["target_amount"]))
            for goal in valid_goals
        ) / len(valid_goals)
        completed_goals = sum(
            1 for goal in valid_goals
            if float(goal.get("current_amount") or 0) >= float(goal["target_amount"])
        )
        goals_ratio = _clamp(
            (goal_progress * 100) / rules["goals_progress"].good_threshold
        )
    else:
        goal_progress = None
        completed_goals = 0
        goals_ratio = None
    factors.append(_factor(
        rules["goals_progress"], goals_ratio,
        status=_status(goals_ratio or 0),
        evidence={
            "goal_count": len(valid_goals),
            "completed_goals": completed_goals,
            "average_progress": None if goal_progress is None else round(goal_progress * 100, 1),
        },
    ))

    if monthly_income > 0:
        spending_rate = (monthly_expense / monthly_income) * 100
        budget_target = rules["budget_adherence"].good_threshold
        if spending_rate <= budget_target:
            budget_ratio = 1.0
        elif spending_rate >= rules["budget_adherence"].warning_threshold:
            budget_ratio = 0.0
        else:
            warning_limit = rules["budget_adherence"].warning_threshold
            budget_ratio = (warning_limit - spending_rate) / (warning_limit - budget_target)
    else:
        spending_rate = None
        budget_ratio = None
    factors.append(_factor(
        rules["budget_adherence"], budget_ratio,
        status=_status(budget_ratio or 0),
        evidence={
            "income": round(monthly_income, 2),
            "expense": round(monthly_expense, 2),
            "spending_rate": None if spending_rate is None else round(spending_rate, 1),
        },
    ))

    if monthly_income > 0:
        savings = monthly_income - monthly_expense
        savings_rate = (savings / monthly_income) * 100
        savings_ratio = _clamp(savings_rate / rules["monthly_savings"].good_threshold)
    else:
        savings = None
        savings_rate = None
        savings_ratio = None
    factors.append(_factor(
        rules["monthly_savings"], savings_ratio,
        status=_status(savings_ratio or 0),
        evidence={
            "savings": None if savings is None else round(savings, 2),
            "savings_rate": None if savings_rate is None else round(savings_rate, 1),
        },
    ))

    overdue_ratio = _lower_count_is_better(overdue_count, rules["overdue_bills"])
    factors.append(_factor(
        rules["overdue_bills"], overdue_ratio,
        status=_status(overdue_ratio),
        evidence={"overdue_count": overdue_count, "overdue_amount": round(overdue_amount, 2)},
    ))

    category_rows = list(overspending_categories)
    category_ratio = (
        _lower_count_is_better(len(category_rows), rules["category_overspending"])
        if category_comparison_available else None
    )
    factors.append(_factor(
        rules["category_overspending"], category_ratio,
        status=_status(category_ratio or 0),
        evidence={"category_count": len(category_rows), "categories": category_rows[:5]},
    ))

    projected_ratio = _higher_is_better(projected_balance, rules["projected_balance"])
    factors.append(_factor(
        rules["projected_balance"], projected_ratio,
        status=_status(projected_ratio),
        evidence={"projected_balance": round(projected_balance, 2)},
    ))

    total_weight = sum(factor["weight"] for factor in factors)
    raw_points = sum(factor["points"] for factor in factors)
    score = round((raw_points / total_weight) * 100) if total_weight else 0
    available_weight = sum(factor["weight"] for factor in factors if factor["available"])
    confidence = round((available_weight / total_weight) * 100) if total_weight else 0
    if score >= 80:
        level = "excellent"
    elif score >= 65:
        level = "good"
    elif score >= 45:
        level = "attention"
    else:
        level = "critical"

    return {
        "score": max(0, min(100, score)),
        "level": level,
        "confidence": confidence,
        "currency": currency,
        "factors": factors,
        "summary": {
            "positive": sum(1 for factor in factors if factor["status"] == "good"),
            "attention": sum(1 for factor in factors if factor["status"] in {"warning", "critical"}),
            "unavailable": sum(1 for factor in factors if factor["status"] == "unavailable"),
        },
        "methodology": {
            "version": 1,
            "neutral_ratio_for_missing_data": 0.5,
            "total_weight": round(total_weight, 2),
        },
    }
