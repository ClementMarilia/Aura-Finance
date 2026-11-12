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
            is_super_admin_user=lambda candidate: candidate.get("role")
            == "SUPER_ADMIN",
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


def master_connection(s):
    s.user["role"] = "SUPER_ADMIN"
    assert (
        s.client.put(
            "/api/ai/settings", json={"source": "aura", "consent": True}
        ).status_code
        == 200
    )


def test_master_uses_aura_without_request_payment_or_grant(setup):
    s = setup
    master_connection(s)
    assert command(s).status_code == 200
    config = s.client.get("/api/ai/settings").json()
    assert config["master_access"] is True
    assert config["plan"]["access_type"] == "master" and config["plan"]["used"] == 1
    assert s.raw.ai_plans.count_documents({}) == 0
    assert s.raw.ai_plan_events.count_documents({}) == 0
    s.notifications.assert_not_awaited()


def test_old_master_request_button_does_not_create_self_approval_request(setup):
    s = setup
    master_connection(s)
    result = s.client.post("/api/ai/plan/request")
    assert result.status_code == 200 and result.json()["access_type"] == "master"
    assert s.raw.ai_plans.count_documents({}) == 0
    s.notifications.assert_not_awaited()


def test_reconnect_does_not_reset_master_monthly_usage(setup):
    s = setup
    master_connection(s)
    assert command(s).status_code == 200
    s.client.delete("/api/ai/settings")
    master_connection(s)
    config = s.client.get("/api/ai/settings").json()
    assert config["plan"]["used"] == 1
    s.raw.ai_connections.update_one({}, {"$unset": {"busy_until": ""}})
    assert command(s).status_code == 200
    assert s.client.get("/api/ai/settings").json()["plan"]["used"] == 2


def test_master_quota_renews_only_at_new_calendar_month(setup, monkeypatch):
    s = setup
    master_connection(s)
    start = datetime(2026, 11, 20, tzinfo=timezone.utc)
    monkeypatch.setattr(ai, "utcnow", lambda: start)
    assert command(s).status_code == 200
    s.raw.ai_connections.update_one(
        {}, {"$set": {"master_used": 300}, "$unset": {"busy_until": ""}}
    )
    assert command(s).json()["detail"] == "AI_MASTER_LIMIT"
    s.client.post("/api/ai/plan/request")
    assert s.raw.ai_connections.find_one()["master_used"] == 300
    monkeypatch.setattr(
        ai, "utcnow", lambda: datetime(2026, 12, 1, tzinfo=timezone.utc)
    )
    assert command(s).status_code == 200
    assert s.raw.ai_connections.find_one()["master_used"] == 1
    assert s.raw.ai_connections.find_one()["master_period"] == "2026-12"


def test_master_failure_refunds_command_without_subscription_mutation(
    setup, monkeypatch
):
    s = setup
    master_connection(s)

    def fail(*args):
        raise HTTPException(503, "AI_PROVIDER_UNAVAILABLE")

    monkeypatch.setattr(ai, "call_provider", fail)
    assert command(s).status_code == 503
    config = s.raw.ai_connections.find_one()
    assert config["master_used"] == 0 and config["master_attempts"] == 1
    assert s.raw.ai_plans.count_documents({}) == 0


def test_regular_admin_and_client_flags_cannot_bypass_access_approval(setup):
    s = setup
    s.user.update(role="ADMIN", is_super_admin=True)
    s.client.put("/api/ai/settings", json={"source": "aura", "consent": True})
    assert command(s).status_code == 403
    assert s.client.get("/api/ai/settings").json()["master_access"] is False
    assert (
        s.client.put(
            "/api/ai/settings",
            json={"source": "aura", "consent": True, "master_access": True},
        ).status_code
        == 422
    )


def test_revoked_master_role_stops_direct_access(setup):
    s = setup
    master_connection(s)
    assert command(s).status_code == 200
    s.user["role"] = "MEMBER"
    s.raw.ai_connections.update_one({}, {"$unset": {"busy_until": ""}})
    assert command(s).status_code == 403


def test_aura_save_ignores_hidden_nine_character_personal_key(setup):
    s = setup
    s.user["role"] = "SUPER_ADMIN"
    response = s.client.put(
        "/api/ai/settings",
        json={
            "source": "aura",
            "provider": "gemini",
            "model": "gemini-3.5-flash-lite",
            "key": "short-key",
            "consent": True,
        },
    )
    assert response.status_code == 200
    stored = s.raw.ai_connections.find_one()
    assert stored["source"] == "aura" and "encrypted_key" not in stored
    assert command(s).status_code == 200


def test_aura_switch_preserves_personal_provider_model_and_encrypted_key(setup):
    s = setup
    own = {
        "source": "own",
        "provider": "openai",
        "model": "gpt-4.1-mini",
        "key": "personal-private-test-key",
        "consent": True,
    }
    assert s.client.put("/api/ai/settings", json=own).status_code == 200
    before = s.raw.ai_connections.find_one()
    assert (
        s.client.put(
            "/api/ai/settings",
            json={
                "source": "aura",
                "provider": "gemini",
                "model": "no-longer-valid",
                "key": "short-key",
                "consent": True,
            },
        ).status_code
        == 200
    )
    after = s.raw.ai_connections.find_one()
    assert after["provider"] == before["provider"] == "openai"
    assert after["model"] == before["model"] == "gpt-4.1-mini"
    assert after["encrypted_key"] == before["encrypted_key"]
    own.pop("key")
    assert s.client.put("/api/ai/settings", json=own).status_code == 200


def test_off_mode_ignores_personal_fields_but_own_mode_validates_them(setup):
    s = setup
    assert (
        s.client.put(
            "/api/ai/settings",
            json={
                "source": "off",
                "key": "short-key",
                "provider": "invalid",
                "consent": True,
            },
        ).status_code
        == 200
    )
    assert (
        s.client.put(
            "/api/ai/settings",
            json={"source": "own", "key": "short-key", "consent": True},
        ).status_code
        == 422
    )
    assert (
        s.client.put(
            "/api/ai/settings",
            json={
                "source": "aura",
                "key": "short-key",
                "master_access": True,
                "consent": True,
            },
        ).status_code
        == 422
    )


def test_master_can_raise_quota_and_continue_without_resetting_usage(setup):
    s = setup
    s.user["id"] = "admin"
    master_connection(s)
    assert command(s).status_code == 200
    s.raw.ai_connections.update_one(
        {}, {"$set": {"master_used": 300}, "$unset": {"busy_until": ""}}
    )
    assert command(s).json()["detail"] == "AI_MASTER_LIMIT"
    result = s.client.put("/api/admin/ai/master-settings", json={"command_limit": 5000})
    assert result.status_code == 200 and result.json()["used"] == 300
    assert result.json()["command_limit"] == 5000
    assert s.client.get("/api/ai/settings").json()["limit"] == 5000
    s.raw.ai_connections.update_one({}, {"$unset": {"busy_until": ""}})
    assert command(s).status_code == 200
    assert s.client.get("/api/ai/settings").json()["plan"]["used"] == 301


def test_master_limit_persists_across_reconnect_and_month_rollover(setup, monkeypatch):
    s = setup
    s.user["id"] = "admin"
    master_connection(s)
    monkeypatch.setattr(
        ai, "utcnow", lambda: datetime(2026, 11, 20, tzinfo=timezone.utc)
    )
    assert (
        s.client.put(
            "/api/admin/ai/master-settings", json={"command_limit": 1200}
        ).status_code
        == 200
    )
    assert command(s).status_code == 200
    s.client.delete("/api/ai/settings")
    master_connection(s)
    assert s.client.get("/api/admin/ai/master-settings").json()["used"] == 1
    monkeypatch.setattr(
        ai, "utcnow", lambda: datetime(2026, 12, 1, tzinfo=timezone.utc)
    )
    assert command(s).status_code == 200
    plan = s.client.get("/api/admin/ai/master-settings").json()
    assert plan["used"] == 1 and plan["command_limit"] == 1200


def test_master_can_reduce_limit_below_current_usage_without_erasing_usage(setup):
    s = setup
    s.user["id"] = "admin"
    master_connection(s)
    assert command(s).status_code == 200
    s.raw.ai_connections.update_one(
        {}, {"$set": {"master_used": 10}, "$unset": {"busy_until": ""}}
    )
    result = s.client.put("/api/admin/ai/master-settings", json={"command_limit": 5})
    assert result.json()["used"] == 10 and result.json()["remaining"] == 0
    assert command(s).json()["detail"] == "AI_MASTER_LIMIT"


def test_regular_admin_cannot_change_master_quota_or_target_other_users(setup):
    s = setup
    s.actor["id"] = "ordinary-admin"
    assert s.client.get("/api/admin/ai/master-settings").status_code == 403
    assert (
        s.client.put(
            "/api/admin/ai/master-settings", json={"command_limit": 10000}
        ).status_code
        == 403
    )
    s.actor["id"] = "admin"
    assert (
        s.client.put(
            "/api/admin/ai/master-settings",
            json={"command_limit": 1000, "user_id": "victim"},
        ).status_code
        == 422
    )


@pytest.mark.parametrize("value", [0, -1, 1.5, True, 1000001])
def test_invalid_master_limit_cannot_change_the_counter(setup, value):
    s = setup
    assert (
        s.client.put(
            "/api/admin/ai/master-settings", json={"command_limit": value}
        ).status_code
        == 422
    )
    assert s.raw.ai_connections.count_documents({}) == 0


def test_payment_status_and_followup_are_preserved(setup, monkeypatch):
    s = setup
    subscribe(s)
    captured = []
    def provider(*args):
        captured.append(args[2])
        assert 'status (paid|pending)' in args[2]
        assert 'reimbursement is still owed' in args[2]
        return {'type': 'expense', 'status': 'pending', 'amount': 269.99, 'description': 'Amazon RAM', 'date': '2026-12-15', 'currency': 'EUR', 'question': 'Qual conta?'}
    monkeypatch.setattr(ai, 'call_provider', provider)
    first = command(s, text='Comprei no cartão da Nathalia, ainda tenho que pagar a ela, 269.99 euros dia 15 de dezembro')
    assert first.status_code == 200
    draft = first.json()['draft']
    assert draft['status'] == 'pending'
    assert draft['date'] == '2026-12-15'
    s.raw.ai_connections.update_one({'_id': 'alice'}, {'$unset': {'busy_until': ''}})
    result = command(s, text='Compra Amazon', previous_draft=draft, clarifications=[{'question': 'Qual conta?', 'answer': 'Registrar como dívida para pagar depois'}])
    assert result.status_code == 200
    assert 'Registrar como d' in captured[-1]
    assert '269.99' in captured[-1]
    assert s.raw.transactions.count_documents({}) == 0


@pytest.mark.parametrize('status', ['paid', 'pending'])
def test_draft_preserves_payment_status(status):
    assert ai.Draft(type='expense', description='Compra', status=status).status == status


def test_missing_status_defaults_pending():
    assert ai.Draft(type='expense', description='Compra').status == 'pending'


def test_clarification_history_bounded():
    with pytest.raises(ValueError):
        ai.Command(today='2026-11-11', clarifications=[{'question': 'Conta?', 'answer': 'Revolut'}] * 9)


@pytest.mark.parametrize("model", ["gpt-4.1-mini", "gpt-4o-mini"])
def test_openai_requests_constrained_transaction_schema(monkeypatch, model):
    calls = []
    def post(url, **kwargs):
        calls.append(kwargs["json"])
        return {"choices": [{"message": {"content": '{"type":"expense","status":"pending","amount":269.99,"description":"Amazon","date":"2026-12-15"}'}}]}
    monkeypatch.setattr(ai, "post_provider", post)
    result = ai.call_provider("openai", "secret", "context", "Still owe Nathalia", model=model)
    assert result["status"] == "pending"
    fmt = calls[0]["response_format"]
    assert fmt["type"] == "json_schema"
    assert fmt["json_schema"]["strict"] is True
    schema = fmt["json_schema"]["schema"]
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(ai.Draft.model_fields)
    assert schema["properties"]["status"]["enum"] == ["paid", "pending"]
    assert len(calls) == 1


def test_invalid_provider_output_logs_only_schema_fields(setup, monkeypatch, caplog):
    s = setup
    subscribe(s)
    monkeypatch.setattr(ai, "call_provider", lambda *args: {"type": "expense", "description": "PRIVATE PURCHASE", "status": "PRIVATE INVALID VALUE"})
    result = command(s)
    assert result.status_code == 502
    assert result.json()["detail"] == "AI_INVALID_RESPONSE"
    assert "status" in caplog.text
    assert "PRIVATE" not in caplog.text
    assert s.raw.transactions.count_documents({}) == 0
    assert s.raw.ai_plans.find_one({"_id": "alice"})["used"] == 0


def test_ai_notes_are_validated_returned_and_preserved_in_followup(setup, monkeypatch):
    s = setup
    subscribe(s)
    notes = "Comprei no cartão da Nathalia e ainda tenho que pagar a ela."
    contexts = []
    def provider(*args):
        contexts.append(args[2])
        return {"type": "expense", "status": "pending", "amount": 269.99,
                "description": "Compra RAM Amazon", "notes": notes, "date": "2026-12-15"}
    monkeypatch.setattr(ai, "call_provider", provider)
    first = command(s, text="Compra Amazon, adc em observações que comprei no cartão da Nathalia")
    assert first.status_code == 200
    draft = first.json()["draft"]
    assert draft["notes"] == notes
    assert draft["description"] == "Compra RAM Amazon"
    s.raw.ai_connections.update_one({"_id": "alice"}, {"$unset": {"busy_until": ""}})
    followup = command(s, previous_draft=draft, clarifications=[{"question": "Conta?", "answer": "Revolut"}])
    assert followup.status_code == 200
    assert followup.json()["draft"]["notes"] == notes
    assert notes in contexts[-1]
    assert s.raw.transactions.count_documents({}) == 0
    with pytest.raises(ValueError):
        ai.Draft(type="expense", description="Compra", notes="x" * 1001)


def test_installment_interpretation_uses_existing_quota_and_returns_purchase_draft(setup, monkeypatch):
    s = setup
    subscribe(s)
    contexts = []
    def provider(*args):
        contexts.append(args[2])
        return {"type": "expense", "status": "pending", "amount": 100, "amount_mode": "per_parcel", "installments": 6, "start_number": 3, "date": "2026-12-15", "description": "Notebook", "account_id": "foreign"}
    monkeypatch.setattr(ai, "call_provider", provider)
    result = command(s, kind="installment", text="Notebook 6 parcelas de 100, próxima é 3, dia 15 dezembro")
    assert result.status_code == 200
    draft = result.json()["draft"]
    assert draft["amount"] == 100
    assert draft["amount_mode"] == "per_parcel"
    assert draft["installments"] == 6
    assert draft["start_number"] == 3
    assert draft["account_id"] is None
    assert "do NOT multiply" in contexts[-1]
    assert s.raw.ai_plans.find_one({"_id": "alice"})["used"] == 1
    assert s.raw.transactions.count_documents({}) == 0
    assert s.raw.installment_purchases.count_documents({}) == 0


@pytest.mark.parametrize("fields", [{"installments": 121}, {"installments": True}, {"installments": 6, "start_number": 7}, {"amount_mode": "guess"}])
def test_invalid_installment_draft_is_rejected(fields):
    with pytest.raises(ValueError):
        ai.Draft(type="expense", description="Compra", **fields)


def test_installment_missing_values_remain_unknown():
    draft = ai.Draft(type="expense", description="Compra")
    assert draft.installments is None
    assert draft.amount_mode is None
    assert draft.date is None


def test_incomplete_installment_asks_for_missing_schedule(setup):
    s = setup
    subscribe(s)
    result = command(s, kind="installment")
    assert result.status_code == 200
    assert result.json()["draft"]["installments"] is None
    assert result.json()["draft"]["question"]
