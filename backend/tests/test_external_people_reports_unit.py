import importlib
import os
import sys
from pathlib import Path


os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aura_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
server = importlib.import_module("server")


def test_external_participant_keeps_explicit_reference_without_fake_user():
    splits = server.compute_splits(
        90,
        "equal",
        [
            {"user_id": "marilia", "person_id": None},
            {"user_id": None, "person_id": "mother"},
            {"user_id": None, "person_id": "friend"},
        ],
    )

    assert [server.participant_reference(item) for item in splits] == [
        "marilia", "mother", "friend",
    ]
    assert splits[1]["user_id"] is None
    assert splits[1]["person_id"] == "mother"
    assert sum(item["owed"] for item in splits) == 90


def test_external_debts_participate_in_shared_expense_status():
    expense = {
        "payer_id": "marilia",
        "participants": [
            {"user_id": "marilia", "owed": 40, "paid_back": False},
            {
                "participant_id": "mother",
                "user_id": None,
                "person_id": "mother",
                "owed": 40,
                "paid_back": False,
            },
        ],
    }
    assert server.shared_expense_status(expense) == "open"
    expense["participants"][1]["paid_back"] = True
    assert server.shared_expense_status(expense) == "finalized"


def row(**overrides):
    base = {
        "id": "row",
        "type": "expense",
        "date": "2026-07-10",
        "description": "Mensalidade da Academia",
        "notes": "Plano verão",
        "category": "Saúde",
        "status": "paid",
        "account_ids": ["wallet-1"],
        "participant_ids": [],
        "participant_names": [],
        "base_amount": 50,
        "direction": "expense",
    }
    base.update(overrides)
    return base


def test_combined_report_filters_are_accent_and_case_insensitive():
    rows = [
        row(),
        row(
            id="shared",
            type="shared_expense",
            date="2026-07-20",
            description="Café com a família",
            category="Alimentação",
            status="pending",
            account_ids=[],
            participant_ids=["marilia", "mother"],
            participant_names=["Marília", "Minha mãe"],
            direction="receivable",
        ),
    ]
    filters = server.ReportFiltersIn(
        description="mae",
        category_ids=["food"],
        participant_ids=["mother"],
        statuses=["pending"],
        types=["shared_expense"],
        period="month",
        month="2026-07",
    )

    result = server.apply_custom_report_filters(
        rows,
        filters,
        {"health": "Saúde", "food": "Alimentação"},
    )

    assert [item["id"] for item in result] == ["shared"]


def test_custom_range_and_account_filters_can_be_combined():
    rows = [
        row(id="inside"),
        row(id="outside", date="2026-08-01"),
        row(id="other-wallet", account_ids=["wallet-2"]),
    ]
    filters = server.ReportFiltersIn(
        period="range",
        start_date="2026-07-01",
        end_date="2026-07-31",
        account_ids=["wallet-1"],
    )

    result = server.apply_custom_report_filters(rows, filters, {})
    assert [item["id"] for item in result] == ["inside"]


def test_filtered_summary_separates_money_directions():
    summary = server.summarize_custom_report([
        row(base_amount=100, direction="income"),
        row(id="expense", base_amount=30, direction="expense"),
        row(id="receivable", base_amount=20, direction="receivable", status="pending"),
        row(id="payable", base_amount=5, direction="payable", status="overdue"),
        row(id="settled", base_amount=10, direction="settled"),
    ])

    assert summary == {
        "income": 100,
        "expense": 30,
        "transfers": 0,
        "shared_receivable": 20,
        "shared_payable": 5,
        "settled": 10,
        "balance": 85,
        "count": 5,
    }


def test_selected_person_summary_shows_what_they_paid_received_and_owe():
    rows = [
        {
            **row(id="pending-credit", type="shared_expense", status="pending", base_amount=40),
            "participants": [
                {"id": "mother", "name": "Minha mãe", "role": "creditor"},
                {"id": "friend", "name": "Amiga", "role": "debtor"},
            ],
        },
        {
            **row(id="pending-debt", type="shared_expense", status="overdue", base_amount=15),
            "participants": [
                {"id": "friend", "name": "Amiga", "role": "creditor"},
                {"id": "mother", "name": "Minha mãe", "role": "debtor"},
            ],
        },
        {
            **row(id="received", type="settlement", status="completed", base_amount=20),
            "participants": [
                {"id": "friend", "name": "Amiga", "role": "debtor"},
                {"id": "mother", "name": "Minha mãe", "role": "creditor"},
            ],
        },
        {
            **row(id="paid", type="settlement", status="completed", base_amount=5),
            "participants": [
                {"id": "mother", "name": "Minha mãe", "role": "debtor"},
                {"id": "friend", "name": "Amiga", "role": "creditor"},
            ],
        },
    ]

    assert server.summarize_report_participant(rows, "mother") == {
        "id": "mother",
        "name": "Minha mãe",
        "to_receive": 40,
        "to_pay": 15,
        "received": 20,
        "paid": 5,
        "balance": 25,
    }
