import asyncio
import importlib
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException


os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aura_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
server = importlib.import_module("server")


class FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return [
            {"date": "2026-07-21", "base": "EUR", "quote": "BRL", "rate": 6.5},
            {"date": "2026-07-21", "base": "EUR", "quote": "USD", "rate": 1.15},
            {"date": "2026-07-21", "base": "EUR", "quote": "CHF", "rate": 0.93},
        ]


def test_supported_currency_validation():
    assert server.normalize_currency("brl") == "BRL"
    with pytest.raises(HTTPException) as exc:
        server.normalize_currency("BTC")
    assert exc.value.status_code == 400


def test_amount_uses_stored_snapshot_and_keeps_original():
    transaction = {
        "amount": 100,
        "currency": "EUR",
        "exchange_rates": {"EUR": 1, "BRL": 6.5, "USD": 1.15, "CHF": 0.93},
    }
    assert server.amount_in_currency(transaction, "EUR") == 100
    assert server.amount_in_currency(transaction, "BRL") == 650
    assert transaction["amount"] == 100


def test_manual_rate_can_be_rebased_without_losing_the_real_conversion():
    transaction = {
        "amount": 100,
        "currency": "BRL",
        "exchange_rates": {"BRL": 1, "EUR": 0.15},
        "base_currency_at_creation": "EUR",
        "exchange_rate_to_base": 0.15,
    }
    rate = server.rate_for_new_base(transaction, "EUR", "USD", 1.2)
    assert rate == pytest.approx(0.18)
    assert transaction["exchange_rates"] == {"BRL": 1, "EUR": 0.15}


def test_fetch_snapshot_from_official_provider(monkeypatch):
    server._fx_cache.clear()
    monkeypatch.setattr(server.requests, "get", lambda *args, **kwargs: FakeResponse())
    snapshot = asyncio.run(server.fetch_currency_snapshot("EUR", "2026-07-22"))
    assert snapshot["rates"] == {"EUR": 1.0, "BRL": 6.5, "USD": 1.15, "CHF": 0.93}
    assert snapshot["date"] == "2026-07-21"
    assert snapshot["source"] == "frankfurter"


def test_future_date_uses_latest_available_rate_as_estimate(monkeypatch):
    server._fx_cache.clear()
    request_params = {}

    def fake_get(*args, **kwargs):
        request_params.update(kwargs["params"])
        return FakeResponse()

    monkeypatch.setattr(server.requests, "get", fake_get)
    snapshot = asyncio.run(server.fetch_currency_snapshot("EUR", "2999-08-14"))

    assert request_params["date"] == datetime.now(timezone.utc).date().isoformat()
    assert snapshot["requested_date"] == "2999-08-14"
    assert snapshot["date"] == "2026-07-21"
    assert snapshot["estimated"] is True


def test_missing_target_rate_never_falls_back_to_one(monkeypatch):
    async def incomplete_snapshot(*args, **kwargs):
        return {
            "base": "BRL",
            "date": "2026-07-21",
            "rates": {"BRL": 1.0},
            "source": "frankfurter",
        }

    monkeypatch.setattr(server, "fetch_currency_snapshot", incomplete_snapshot)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.monetary_metadata("BRL", "EUR", "2026-07-22"))
    assert exc.value.status_code == 503


def test_manual_rate_survives_provider_failure(monkeypatch):
    async def fail(*args, **kwargs):
        raise HTTPException(503, "offline")

    monkeypatch.setattr(server, "fetch_currency_snapshot", fail)
    metadata = asyncio.run(server.monetary_metadata("BRL", "EUR", "2026-07-22", 0.15))
    assert metadata["currency"] == "BRL"
    assert metadata["exchange_rate_to_base"] == 0.15
    assert metadata["rate_source"] == "manual"


def test_transfer_keeps_sent_and_received_amounts(monkeypatch):
    async def account_map(_user):
        return {"usd-wallet": "USD", "eur-wallet": "EUR"}

    async def snapshot(_currency, _date=None):
        return {
            "base": "USD", "date": "2026-07-22", "source": "frankfurter",
            "rates": {"USD": 1, "EUR": 0.9, "BRL": 5.8, "CHF": 0.82},
        }

    monkeypatch.setattr(server, "account_currency_map", account_map)
    monkeypatch.setattr(server, "fetch_currency_snapshot", snapshot)
    payload = server.TransactionIn(
        type="transfer",
        date="2026-07-22",
        amount=100,
        from_account_id="usd-wallet",
        to_account_id="eur-wallet",
        status="paid",
    )
    values = asyncio.run(server.transaction_values(payload, {"id": "u1", "currency": "EUR"}))
    assert values["amount"] == 100
    assert values["currency"] == "USD"
    assert values["target_amount"] == 90
    assert values["target_currency"] == "EUR"
    assert values["transfer_exchange_rate"] == 0.9


def test_automatic_transaction_rate_cannot_be_overridden_by_one_to_one(monkeypatch):
    async def account_map(_user):
        return {}

    async def snapshot(_currency, _date=None):
        return {
            "base": "BRL",
            "date": "2026-07-22",
            "rates": {"BRL": 1.0, "EUR": 0.16, "USD": 0.18, "CHF": 0.15},
            "source": "frankfurter",
        }

    monkeypatch.setattr(server, "account_currency_map", account_map)
    monkeypatch.setattr(server, "fetch_currency_snapshot", snapshot)
    payload = server.TransactionIn(
        type="expense",
        date="2026-07-22",
        amount=1786,
        currency="BRL",
        exchange_rate=1,
        rate_source="automatic",
    )

    values = asyncio.run(server.transaction_values(payload, {"id": "u1", "currency": "EUR"}))

    assert values["exchange_rate_to_base"] == pytest.approx(0.16)
    assert values["base_amount"] == pytest.approx(285.76)
