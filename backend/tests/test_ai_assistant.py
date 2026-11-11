import base64
import io
import wave
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import mongomock
import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import ai_assistant as ai


class Cursor:
    def __init__(self, cursor):
        self.cursor = cursor

    def sort(self, *args):
        self.cursor = self.cursor.sort(*args)
        return self

    def limit(self, count):
        self.cursor = self.cursor.limit(count)
        return self

    async def to_list(self, count):
        return list(self.cursor)[:count]


class Collection:
    def __init__(self, collection):
        self.raw = collection

    def find(self, *args, **kwargs):
        return Cursor(self.raw.find(*args, **kwargs))

    async def find_one(self, *args, **kwargs):
        return self.raw.find_one(*args, **kwargs)

    async def find_one_and_update(self, *args, **kwargs):
        return self.raw.find_one_and_update(*args, **kwargs)

    async def update_one(self, *args, **kwargs):
        return self.raw.update_one(*args, **kwargs)

    async def insert_one(self, *args, **kwargs):
        return self.raw.insert_one(*args, **kwargs)


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setenv("AI_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("AURA_AI_PROVIDER", "gemini")
    monkeypatch.setenv("AURA_GEMINI_API_KEY", "server-secret")
    monkeypatch.setenv("AURA_AI_PAYMENT_INSTRUCTIONS", "Contact admin to pay €5.")
    raw = mongomock.MongoClient().db
    db = SimpleNamespace(
        **{
            name: Collection(raw[name])
            for name in (
                "ai_connections",
                "ai_plans",
                "ai_plan_events",
                "users",
                "categories",
                "accounts",
            )
        }
    )
    user = {"id": "alice", "currency": "EUR"}
    actor = {"id": "admin"}

    async def admin():
        if actor["id"] != "admin":
            raise HTTPException(403, "forbidden")
        return actor

    app = FastAPI()
    notifications = AsyncMock()
    app.include_router(
        ai.create_ai_router(
            db=db,
            get_current_user=lambda: user,
            require_super_admin=admin,
            push_notification=notifications,
            admin_email=lambda: "admin@example.com",
        )
    )
    raw.users.insert_one({"id": "admin", "email": "admin@example.com"})
    monkeypatch.setattr(
        ai,
        "call_provider",
        lambda *args: {
            "type": "expense",
            "amount": 32,
            "description": "Fuel",
            "date": "2026-11-10",
            "category_id": "fuel",
            "account_id": "wallet",
            "currency": "EUR",
            "question": "",
        },
    )
    return SimpleNamespace(
        client=TestClient(app),
        raw=raw,
        user=user,
        actor=actor,
        notifications=notifications,
    )


def subscribe(s):
    request = s.client.post("/api/ai/plan/request").json()
    assert approve(s, request["request_id"]).status_code == 200
    assert (
        s.client.put(
            "/api/ai/settings", json={"source": "aura", "consent": True}
        ).status_code
        == 200
    )
    return request


def approve(s, rid, **extra):
    return s.client.post(
        "/api/admin/ai/plans/alice",
        json={
            "request_id": rid,
            "action": "approve",
            "payment_confirmed": True,
            **extra,
        },
    )


def command(s, **extra):
    return s.client.post(
        "/api/ai/interpret",
        json={"text": "Paid 32 for fuel", "today": "2026-11-10", **extra},
    )


def test_payment_report_does_not_activate_duplicate_approval_does_not_extend(setup):
    s = setup
    request = s.client.post("/api/ai/plan/request").json()
    rid = request["request_id"]
    assert s.client.post("/api/ai/plan/request").status_code == 409
    assert (
        s.client.post(
            "/api/ai/plan/payment", json={"request_id": rid, "reference": "wire123"}
        ).status_code
        == 200
    )
    assert s.raw.ai_plans.find_one()["status"] == "payment_reported"
    assert approve(s, rid, payment_confirmed=False).status_code == 422
    assert approve(s, rid).status_code == 200
    expires = s.raw.ai_plans.find_one()["expires_at"]
    assert approve(s, rid).status_code == 409
    assert s.raw.ai_plans.find_one()["expires_at"] == expires
    assert s.raw.ai_plan_events.count_documents({}) == 1


def test_only_superadmin_can_read_or_activate(setup):
    s = setup
    s.actor["id"] = "ordinary"
    assert s.client.get("/api/admin/ai/plans").status_code == 403
    assert approve(s, "fake").status_code == 403


def test_encrypted_key_never_returned_and_disconnect_deletes(setup):
    s = setup
    key = "user-private-key-12345"
    assert (
        s.client.put(
            "/api/ai/settings",
            json={"source": "own", "provider": "openai", "key": key, "consent": True},
        ).status_code
        == 200
    )
    stored = s.raw.ai_connections.find_one()["encrypted_key"]
    assert key not in stored and ai.cipher().decrypt(stored.encode()).decode() == key
    response = s.client.get("/api/ai/settings")
    assert key not in response.text and stored not in response.text
    assert response.json()["has_key"] is True
    assert (
        s.client.put(
            "/api/ai/settings",
            json={"source": "own", "provider": "gemini", "consent": True},
        ).status_code
        == 422
    )
    # Switching source must never relabel an OpenAI key as a Gemini key.
    assert (
        s.client.put(
            "/api/ai/settings",
            json={"source": "aura", "provider": "gemini", "consent": True},
        ).status_code
        == 200
    )
    assert (
        s.client.put(
            "/api/ai/settings",
            json={"source": "own", "provider": "gemini", "consent": True},
        ).status_code
        == 422
    )
    assert s.client.delete("/api/ai/settings").status_code == 200
    assert "encrypted_key" not in s.raw.ai_connections.find_one()


def test_quota_expiry_suspension_retry_budget_block_provider(setup, monkeypatch):
    s = setup
    subscribe(s)
    monkeypatch.setattr(
        ai, "call_provider", lambda *args: pytest.fail("must not call provider")
    )
    for change in (
        {"used": 300},
        {"used": 0, "expires_at": "2020-01-01T00:00:00+00:00"},
        {"expires_at": "2099-01-01T00:00:00+00:00", "status": "suspended"},
        {"status": "active", "attempts": 360},
    ):
        s.raw.ai_connections.update_one({}, {"$unset": {"busy_until": ""}})
        s.raw.ai_plans.update_one({}, {"$set": change})
        assert command(s).status_code == 403


def test_last_command_foreign_ids_and_no_financial_writes(setup):
    s = setup
    subscribe(s)
    s.raw.categories.insert_one(
        {"id": "fuel", "user_id": "other", "name": "Private", "kind": "expense"}
    )
    s.raw.accounts.insert_one(
        {"id": "wallet", "user_id": "other", "name": "Secret", "currency": "EUR"}
    )
    s.raw.ai_plans.update_one({}, {"$set": {"used": 299}})
    response = command(s)
    assert response.status_code == 200
    assert response.json()["draft"]["category_id"] is None
    assert response.json()["draft"]["account_id"] is None
    assert s.raw.ai_plans.find_one()["used"] == 300
    s.raw.ai_connections.update_one({}, {"$unset": {"busy_until": ""}})
    assert command(s).status_code == 403
    assert s.raw.transactions.count_documents({}) == 0


def test_failure_refunds_command_but_counts_attempt(setup, monkeypatch):
    s = setup
    subscribe(s)

    def fail(*args):
        raise HTTPException(429, "AI_PROVIDER_LIMIT")

    monkeypatch.setattr(ai, "call_provider", fail)
    assert command(s).status_code == 429
    plan = s.raw.ai_plans.find_one()
    assert plan["used"] == 0 and plan["attempts"] == 1
    assert "lease" not in s.raw.ai_connections.find_one()


def test_own_connection_has_no_paid_requirement_or_paid_fallback(setup, monkeypatch):
    s = setup
    keys = []
    s.client.put(
        "/api/ai/settings",
        json={
            "source": "own",
            "provider": "gemini",
            "key": "own-gemini-secret",
            "consent": True,
        },
    )

    def fail(provider, key, *args):
        keys.append(key)
        raise HTTPException(429, "AI_PROVIDER_LIMIT")

    monkeypatch.setattr(ai, "call_provider", fail)
    assert command(s).status_code == 429
    assert keys == ["own-gemini-secret"] and s.raw.ai_plans.count_documents({}) == 0


def test_cross_worker_lease_blocks_duplicate_call(setup, monkeypatch):
    s = setup
    subscribe(s)
    s.raw.ai_connections.update_one(
        {}, {"$set": {"busy_until": (ai.utcnow() + timedelta(seconds=90)).isoformat()}}
    )
    monkeypatch.setattr(
        ai, "call_provider", lambda *args: pytest.fail("must not call provider")
    )
    assert command(s).status_code == 429
    assert s.raw.ai_plans.find_one()["used"] == 0


def test_plan_is_scoped_to_authenticated_user(setup):
    s = setup
    subscribe(s)
    s.user["id"] = "bob"
    s.client.put("/api/ai/settings", json={"source": "aura", "consent": True})
    assert command(s).status_code == 403
    assert s.raw.ai_plans.find_one({"_id": "alice"})["used"] == 0


def test_negative_provider_amount_is_rejected(setup, monkeypatch):
    s = setup
    subscribe(s)
    monkeypatch.setattr(
        ai,
        "call_provider",
        lambda *args: {"type": "expense", "amount": -40, "description": "bad"},
    )
    assert command(s).status_code == 502
    assert s.raw.ai_plans.find_one()["used"] == 0


def test_stale_approval_cannot_activate_new_request(setup):
    s = setup
    previous = subscribe(s)
    s.raw.ai_plans.update_one({}, {"$set": {"expires_at": "2020-01-01T00:00:00+00:00"}})
    current = s.client.post("/api/ai/plan/request").json()
    assert current["request_id"] != previous["request_id"]
    assert approve(s, previous["request_id"]).status_code == 409
    assert s.raw.ai_plans.find_one()["status"] == "pending"


def test_calendar_month_clamps_end_of_month():
    assert ai.next_month(datetime(2027, 1, 31, tzinfo=timezone.utc)).day == 28
    assert ai.next_month(datetime(2028, 1, 31, tzinfo=timezone.utc)).day == 29
    assert ai.next_month(datetime(2026, 12, 10, tzinfo=timezone.utc)).year == 2027


def wav(seconds):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\0\0" * int(seconds * 16000))
    return base64.b64encode(buf.getvalue()).decode()


def test_audio_duration_validated_before_call(setup):
    s = setup
    subscribe(s)
    assert len(ai.read_audio(wav(30))) == 960044
    for data in (wav(31), wav(0), "not-base64", base64.b64encode(b"junk").decode()):
        assert command(s, text="", audio=data).status_code == 422
    assert s.raw.ai_plans.find_one()["attempts"] == 0


def test_client_cannot_inject_model_host_identity(setup):
    s = setup
    assert command(s, user_id="victim").status_code == 422
    assert command(s, model="expensive-model").status_code == 422
    assert (
        s.client.put(
            "/api/ai/settings",
            json={
                "source": "own",
                "provider": "custom",
                "key": "test-key-value",
                "consent": True,
            },
        ).status_code
        == 422
    )


def test_openai_adapter_transcribes_then_extracts_without_exposing_key(monkeypatch):
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        if url.endswith("/transcriptions"):
            return {"text": "paid 32 for fuel"}
        return {
            "choices": [
                {
                    "message": {
                        "content": '{"type":"expense","amount":32,"description":"Fuel"}'
                    }
                }
            ]
        }

    monkeypatch.setattr(ai, "post_provider", post)
    result = ai.call_provider("openai", "private", "context", "", b"audio")
    assert result["amount"] == 32
    assert calls[0][1]["data"]["model"] == "gpt-4o-mini-transcribe"
    assert calls[1][1]["json"]["model"] == "gpt-4.1-mini"
    assert calls[1][1]["json"]["max_completion_tokens"] == 700
    assert calls[1][1]["json"]["messages"][1]["content"] == "paid 32 for fuel"


def test_gemini_adapter_sends_audio_and_fixed_token_cap(monkeypatch):
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return {"candidates": [{"content": {"parts": [{"text": '{"amount":32}'}]}}]}

    monkeypatch.setattr(ai, "post_provider", post)
    assert (
        ai.call_provider("gemini", "private", "context", "", b"audio")["amount"] == 32
    )
    url, kwargs = calls[0]
    assert url.startswith("https://generativelanguage.googleapis.com/")
    assert "private" not in url
    assert kwargs["headers"]["x-goog-api-key"] == "private"
    assert (
        kwargs["json"]["contents"][0]["parts"][1]["inlineData"]["mimeType"]
        == "audio/wav"
    )
    assert kwargs["json"]["generationConfig"]["maxOutputTokens"] == 700


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "AI_KEY_REJECTED"),
        (429, "AI_PROVIDER_LIMIT"),
        (500, "AI_PROVIDER_UNAVAILABLE"),
    ],
)
def test_provider_errors_are_sanitized(monkeypatch, status, code):
    monkeypatch.setattr(
        ai.requests,
        "post",
        lambda *args, **kwargs: SimpleNamespace(
            status_code=status, text="private key and internal details"
        ),
    )
    with pytest.raises(HTTPException) as error:
        ai.post_provider("https://api.openai.com/v1/chat/completions")
    assert error.value.detail == code


def test_audio_metadata_and_trailing_bytes_are_not_forwarded():
    original = base64.b64decode(wav(1))
    encoded = base64.b64encode(original + b"private trailing metadata").decode()
    assert ai.read_audio(encoded) == original


@pytest.mark.parametrize(
    "status,code", [(404, "AI_MODEL_UNAVAILABLE"), (400, "AI_REQUEST_REJECTED")]
)
def test_model_and_request_errors_are_distinct_from_outage(monkeypatch, status, code):
    monkeypatch.setattr(
        ai.requests,
        "post",
        lambda *args, **kwargs: SimpleNamespace(
            status_code=status,
            json=lambda: {"error": {"message": "unsupported model parameter"}},
        ),
    )
    with pytest.raises(HTTPException) as error:
        ai.post_provider(
            "https://generativelanguage.googleapis.com/v1beta/models/test:generateContent"
        )
    assert error.value.detail == code


def test_gemini_modern_model_uses_compatible_thinking_config(monkeypatch):
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return {"candidates": [{"content": {"parts": [{"text": '{"amount":32}'}]}}]}

    monkeypatch.setattr(ai, "post_provider", post)
    ai.call_provider(
        "gemini", "private", "context", "paid 32", model="gemini-3.5-flash-lite"
    )
    assert "/gemini-3.5-flash-lite:generateContent" in calls[0][0]
    assert calls[0][1]["json"]["generationConfig"]["thinkingConfig"] == {
        "thinkingLevel": "MINIMAL"
    }


def test_model_selection_preserves_key_and_rejects_other_provider_models(setup):
    s = setup
    assert (
        s.client.put(
            "/api/ai/settings",
            json={
                "source": "own",
                "provider": "gemini",
                "key": "own-gemini-secret",
                "consent": True,
            },
        ).status_code
        == 200
    )
    assert (
        s.client.put(
            "/api/ai/settings",
            json={
                "source": "own",
                "provider": "gemini",
                "model": "gemini-3.5-flash-lite",
                "consent": True,
            },
        ).status_code
        == 200
    )
    assert s.client.get("/api/ai/settings").json()["model"] == "gemini-3.5-flash-lite"
    assert s.client.get("/api/ai/settings").json()["has_key"] is True
    assert (
        s.client.put(
            "/api/ai/settings",
            json={
                "source": "own",
                "provider": "gemini",
                "model": "gpt-4.1-mini",
                "consent": True,
            },
        ).status_code
        == 422
    )


def grant(s, access_type="trial", hours=24, limit=20):
    request = s.client.post("/api/ai/plan/request").json()
    result = s.client.post(
        "/api/admin/ai/plans/alice",
        json={
            "request_id": request["request_id"],
            "action": "approve",
            "access_type": access_type,
            "duration_hours": hours,
            "command_limit": limit,
        },
    )
    assert result.status_code == 200, result.text
    s.client.put("/api/ai/settings", json={"source": "aura", "consent": True})
    return request


def test_trial_request_needs_no_payment_setup_and_notifies_admin(setup, monkeypatch):
    monkeypatch.delenv("AURA_AI_PAYMENT_INSTRUCTIONS")
    s = setup
    request = grant(s)
    assert s.notifications.await_args_list[0].args[0] == "admin"
    plan = s.raw.ai_plans.find_one()
    assert plan["access_type"] == "trial" and plan["command_limit"] == 20
    assert datetime.fromisoformat(plan["expires_at"]) - datetime.fromisoformat(
        plan["starts_at"]
    ) == timedelta(hours=24)
    assert s.raw.ai_plan_events.find_one()["result"]["access_type"] == "trial"
    assert approve(s, request["request_id"]).status_code == 409


def test_courtesy_and_trial_expire_on_server_even_without_a_scheduled_job(
    setup, monkeypatch
):
    s = setup
    start = datetime(2026, 11, 11, 10, tzinfo=timezone.utc)
    monkeypatch.setattr(ai, "utcnow", lambda: start)
    grant(s, "courtesy", hours=2, limit=7)
    assert command(s).status_code == 200
    monkeypatch.setattr(ai, "utcnow", lambda: start + timedelta(hours=2))
    assert command(s).status_code == 403
    assert (
        s.client.get("/api/ai/settings").json()["plan"]["effective_status"] == "expired"
    )


def test_trial_last_command_is_atomic_and_request_does_not_self_approve(setup):
    s = setup
    grant(s, limit=2)
    s.raw.ai_plans.update_one({}, {"$set": {"used": 1}})
    assert command(s).status_code == 200
    s.raw.ai_connections.update_one({}, {"$unset": {"busy_until": ""}})
    assert command(s).status_code == 403
    assert s.client.post("/api/ai/plan/request").status_code == 200
    assert command(s).status_code in (403, 429)
    assert s.raw.ai_plans.find_one()["status"] == "pending"


def test_own_connection_keeps_working_after_aura_trial_expires(setup):
    s = setup
    grant(s)
    s.raw.ai_plans.update_one({}, {"$set": {"expires_at": "2020-01-01T00:00:00+00:00"}})
    s.client.put(
        "/api/ai/settings",
        json={
            "source": "own",
            "provider": "gemini",
            "key": "private-test-key",
            "consent": True,
        },
    )
    assert command(s).status_code == 200
    assert s.raw.ai_plans.find_one()["used"] == 0


def test_payment_required_is_separate_from_grant_and_requires_admin_confirmation(
    setup, monkeypatch
):
    s = setup
    rid = s.client.post("/api/ai/plan/request").json()["request_id"]
    assert (
        s.client.post(
            "/api/admin/ai/plans/alice",
            json={"request_id": rid, "action": "request_payment"},
        ).status_code
        == 200
    )
    assert s.raw.ai_plans.find_one()["status"] == "payment_required"
    s.client.post("/api/ai/plan/payment", json={"request_id": rid, "reference": "wire"})
    assert s.raw.ai_plans.find_one()["status"] == "payment_reported"
    assert approve(s, rid, payment_confirmed=False).status_code == 422
    assert approve(s, rid).status_code == 200
    plan = s.raw.ai_plans.find_one()
    assert plan["access_type"] == "paid" and plan["command_limit"] == 300


def test_adjustment_keeps_usage_and_uses_version_to_reject_replays(setup):
    s = setup
    request = grant(s)
    plan = s.raw.ai_plans.find_one()
    s.raw.ai_plans.update_one({}, {"$set": {"used": 9, "attempts": 10}})
    payload = {
        "request_id": request["request_id"],
        "action": "adjust",
        "duration_hours": 48,
        "command_limit": 30,
        "expected_version": plan["access_version"],
    }
    assert s.client.post("/api/admin/ai/plans/alice", json=payload).status_code == 200
    after = s.raw.ai_plans.find_one()
    assert (
        after["used"] == 9 and after["attempts"] == 10 and after["command_limit"] == 30
    )
    assert s.client.post("/api/admin/ai/plans/alice", json=payload).status_code == 409


@pytest.mark.parametrize(
    "field,value",
    [
        ("duration_hours", 0),
        ("duration_hours", 1.5),
        ("command_limit", 0),
        ("command_limit", 301),
    ],
)
def test_invalid_admin_trial_limits_are_rejected(setup, field, value):
    s = setup
    rid = s.client.post("/api/ai/plan/request").json()["request_id"]
    payload = {
        "request_id": rid,
        "action": "approve",
        "access_type": "trial",
        field: value,
    }
    assert s.client.post("/api/admin/ai/plans/alice", json=payload).status_code == 422
    assert s.raw.ai_plans.find_one()["status"] == "pending"


def test_legacy_paid_plan_without_new_fields_still_has_300_commands(setup):
    s = setup
    subscribe(s)
    s.raw.ai_plans.update_one(
        {},
        {
            "$unset": {
                "command_limit": "",
                "attempt_limit": "",
                "access_type": "",
                "access_version": "",
            }
        },
    )
    assert command(s).status_code == 200
    plan = s.client.get("/api/ai/settings").json()["plan"]
    assert plan["command_limit"] == 300 and plan["access_type"] == "paid"


def test_auto_discovers_and_skips_inaccessible_model_without_switching_provider(
    monkeypatch,
):
    monkeypatch.setattr(
        ai.requests,
        "get",
        lambda *args, **kwargs: SimpleNamespace(
            status_code=200,
            json=lambda: {
                "models": [
                    {
                        "name": "models/gemini-3.5-flash-lite",
                        "supportedGenerationMethods": ["generateContent"],
                    },
                    {
                        "name": "models/gemini-2.5-flash-lite",
                        "supportedGenerationMethods": ["generateContent"],
                    },
                    {
                        "name": "models/expensive-preview",
                        "supportedGenerationMethods": ["generateContent"],
                    },
                ]
            },
        ),
    )
    calls = []

    def post(url, **kwargs):
        calls.append(url)
        if "3.5" in url:
            raise HTTPException(400, "AI_MODEL_UNAVAILABLE")
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": '{"type":"expense","amount":10,"description":"Lunch"}'
                            }
                        ]
                    }
                }
            ]
        }

    monkeypatch.setattr(ai, "post_provider", post)
    result = ai.call_provider(
        "gemini", "user-secret", "context", "Lunch 10", model="auto"
    )
    assert result["_model"] == "gemini-2.5-flash-lite" and len(calls) == 2
    assert all(
        url.startswith("https://generativelanguage.googleapis.com/") for url in calls
    )


def test_auto_does_not_retry_quota_or_activate_paid_fallback(monkeypatch):
    monkeypatch.setattr(
        ai,
        "available_models",
        lambda *args: ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite"],
    )
    calls = []

    def post(url, **kwargs):
        calls.append(url)
        raise HTTPException(429, "AI_PROVIDER_LIMIT")

    monkeypatch.setattr(ai, "post_provider", post)
    with pytest.raises(HTTPException) as error:
        ai.call_provider("gemini", "secret", "context", "Lunch", model="auto")
    assert error.value.detail == "AI_PROVIDER_LIMIT" and len(calls) == 1


def test_auto_openai_transcribes_once_when_first_model_is_missing(monkeypatch):
    monkeypatch.setattr(
        ai, "available_models", lambda *args: ["gpt-4.1-mini", "gpt-4o-mini"]
    )
    calls = []

    def post(url, **kwargs):
        calls.append(url)
        if url.endswith("transcriptions"):
            return {"text": "Lunch 10"}
        if kwargs["json"]["model"] == "gpt-4.1-mini":
            raise HTTPException(400, "AI_MODEL_UNAVAILABLE")
        return {"choices": [{"message": {"content": '{"amount":10}'}}]}

    monkeypatch.setattr(ai, "post_provider", post)
    assert (
        ai.call_provider("openai", "secret", "context", "", b"audio", model="auto")[
            "_model"
        ]
        == "gpt-4o-mini"
    )
    assert sum(url.endswith("transcriptions") for url in calls) == 1


def test_auto_prefers_last_successful_model_when_it_is_still_listed(monkeypatch):
    monkeypatch.setattr(
        ai,
        "available_models",
        lambda *args: ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite"],
    )
    urls = []

    def post(url, **kwargs):
        urls.append(url)
        return {"candidates": [{"content": {"parts": [{"text": '{"amount":10}'}]}}]}

    monkeypatch.setattr(ai, "post_provider", post)
    ai.call_provider(
        "gemini",
        "secret",
        "context",
        "Lunch",
        model="auto",
        preferred_model="gemini-2.5-flash-lite",
    )
    assert len(urls) == 1 and "gemini-2.5-flash-lite:generateContent" in urls[0]


def test_attempt_exhaustion_requires_new_admin_approval(setup):
    s = setup
    grant(s)
    s.raw.ai_plans.update_one({}, {"$set": {"attempts": 25, "used": 0}})
    assert s.client.post("/api/ai/plan/request").status_code == 200
    assert s.raw.ai_plans.find_one()["status"] == "pending"


def test_new_connection_defaults_to_auto_and_requests_can_precede_provider_setup(
    setup, monkeypatch
):
    s = setup
    assert s.client.get("/api/ai/settings").json()["model"] == "auto"
    monkeypatch.delenv("AURA_GEMINI_API_KEY")
    rid = s.client.post("/api/ai/plan/request").json()["request_id"]
    assert (
        s.client.post(
            "/api/admin/ai/plans/alice",
            json={"request_id": rid, "action": "approve", "access_type": "trial"},
        ).status_code
        == 503
    )
    assert s.raw.ai_plans.find_one()["status"] == "pending"
