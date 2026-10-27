"""Read-only Enable Banking proof of concept with owner-controlled permissions.

No financial ledger mutations are performed here. Real banking calls are OFF
until BANKING_ENABLED and application credentials are configured server-side.
"""
import asyncio
import hashlib
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import jwt
import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument

API_BASE = "https://api.enablebanking.com"
ALLOWED_STATES = {"none", "pending", "approved", "denied", "revoked"}
AUDIT_STATES = {"approved", "denied", "revoked"}


def utcnow():
    return datetime.now(timezone.utc)


def banking_enabled():
    return os.getenv("BANKING_ENABLED", "false").lower() == "true"


def banking_configured():
    return bool(
        os.getenv("ENABLE_BANKING_APP_ID")
        and (os.getenv("ENABLE_BANKING_PRIVATE_KEY") or os.getenv("ENABLE_BANKING_PRIVATE_KEY_FILE"))
        and os.getenv("ENABLE_BANKING_CALLBACK_URL", "").startswith("https://")
        and os.getenv("BANKING_RETURN_URL", "").startswith("https://")
    )


def is_allowed(user, is_super_admin):
    return is_super_admin(user) or user.get("banking_access") == "approved"


def is_provider_eligible(user, is_super_admin):
    # Restricted Production is for the Control Panel owner's own linked accounts.
    # Admin approval alone does NOT authorize use by third parties.
    mode = os.getenv("ENABLE_BANKING_MODE", "restricted").lower()
    return mode in {"sandbox", "unrestricted"} or (
        mode == "restricted" and is_super_admin(user)
    )


def jwt_for_provider():
    application_id = os.getenv("ENABLE_BANKING_APP_ID", "")
    key = os.getenv("ENABLE_BANKING_PRIVATE_KEY", "").replace("\\n", "\n")
    if not key and os.getenv("ENABLE_BANKING_PRIVATE_KEY_FILE"):
        with open(os.environ["ENABLE_BANKING_PRIVATE_KEY_FILE"], encoding="utf-8") as file:
            key = file.read()
    now = int(utcnow().timestamp())
    return jwt.encode(
        {"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": now, "exp": now + 900},
        key, algorithm="RS256", headers={"kid": application_id},
    )


async def provider_request(method, path, *, payload=None, params=None):
    """Only fixed API paths supplied by this module; never accept arbitrary URLs."""
    try:
        token = jwt_for_provider()
        response = await asyncio.to_thread(
            requests.request, method, API_BASE + path,
            headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
            json=payload, params=params, timeout=20,
        )
        response.raise_for_status()
        return response.json() if response.content else {}
    except (requests.RequestException, ValueError, OSError, jwt.PyJWTError):
        # Never return upstream bodies: they can contain personal data.
        raise HTTPException(502, "Serviço bancário indisponível; tente novamente mais tarde")


class AccessDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str = Field(pattern="^(approved|denied|revoked)$")


class NewConnection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    institution: str = Field(min_length=1, max_length=120)
    country: str = Field(pattern="^[A-Z]{2}$")


def public_connection(record):
    return {
        "id": record["id"],
        "institution": record["institution"],
        "country": record["country"],
        "status": record["status"],
        "accounts": record.get("accounts", []),
        "authorized_until": record.get("authorized_until"),
        "last_sync_at": record.get("last_sync_at"),
        "created_at": record["created_at"],
    }


def create_banking_router(*, db, get_current_user, require_super_admin, is_super_admin,
                          audit_event, prefix="/api"):
    router = APIRouter(prefix=prefix, tags=["banking"])

    async def require_banking(user=Depends(get_current_user)):
        if not is_allowed(user, is_super_admin):
            raise HTTPException(403, "Conexão bancária depende de aprovação da administradora")
        return user

    def require_provider(user=None):
        if not banking_enabled() or not banking_configured():
            raise HTTPException(503, "Integração bancária ainda não foi configurada")
        if user is not None and not is_provider_eligible(user, is_super_admin):
            raise HTTPException(403, "Provedor restrito a contas próprias da administradora")

    async def track(action, actor_id, target_id, status):
        # Admin never receives financial data from these calls.
        await db.banking_access_audit.insert_one({
            "id": str(uuid.uuid4()), "action": action, "actor_id": actor_id,
            "target_user_id": target_id, "status": status, "at": utcnow(),
        })

    @router.get("/banking/access")
    async def access(user=Depends(get_current_user)):
        allowed = is_allowed(user, is_super_admin)
        return {
            "access": "approved" if allowed else user.get("banking_access", "none"),
            "allowed": allowed,
            "enabled": banking_enabled(),
            "configured": banking_configured(),
            "can_connect": allowed and is_provider_eligible(user, is_super_admin)
                           and banking_enabled() and banking_configured(),
        }

    @router.post("/banking/request")
    async def request_access(user=Depends(get_current_user)):
        if is_allowed(user, is_super_admin):
            return {"access": "approved"}
        if user.get("banking_access") == "pending":
            return {"access": "pending"}
        await db.users.update_one({"id": user["id"]}, {"$set": {"banking_access": "pending"}})
        await track("request", user["id"], user["id"], "pending")
        return {"access": "pending"}

    @router.get("/admin/banking/config")
    async def admin_config(admin=Depends(require_super_admin)):
        return {
            "enabled": banking_enabled(),
            "configured": banking_configured(),
            "provider": "Enable Banking",
            "mode": os.getenv("ENABLE_BANKING_MODE", "restricted"),
            "credentials_managed_on_server": True,
            "read_only": True,
        }

    @router.get("/admin/banking/users")
    async def admin_users(admin=Depends(require_super_admin)):
        users = await db.users.find(
            {}, {"_id": 0, "id": 1, "name": 1, "email": 1,
                 "status": 1, "role": 1, "banking_access": 1}
        ).to_list(length=1000)
        return [
            {"id": u["id"], "name": u.get("name", ""), "email": u.get("email", ""),
             "user_status": u.get("status", "active"),
             "access": "approved" if is_super_admin(u) else u.get("banking_access", "none"),
             "protected": is_super_admin(u)}
            for u in users
        ]

    @router.patch("/admin/banking/users/{user_id}")
    async def decide_access(user_id: str, change: AccessDecision,
                            admin=Depends(require_super_admin)):
        candidate = await db.users.find_one({"id": user_id},
                                             {"_id": 0, "id": 1, "role": 1, "email": 1, "status": 1})
        if not candidate:
            raise HTTPException(404, "Usuário não encontrado")
        if is_super_admin(candidate):
            raise HTTPException(409, "Acesso da super administradora é protegido")
        if change.status == "approved" and candidate.get("status", "active") != "active":
            raise HTTPException(409, "Somente usuários ativos podem receber acesso")
        await db.users.update_one({"id": user_id}, {"$set": {"banking_access": change.status}})
        await track("decision", admin["id"], user_id, change.status)
        if change.status != "approved":
            # Revocation blocks all endpoints immediately. End provider sessions separately.
            await db.bank_connections.update_many(
                {"user_id": user_id, "status": "connected"},
                {"$set": {"status": "access_revoked", "updated_at": utcnow()}},
            )
        return {"id": user_id, "access": change.status}

    @router.get("/banking/institutions")
    async def institutions(country: str = Query(default="IT", pattern="^[A-Z]{2}$"),
                           user=Depends(require_banking)):
        require_provider(user)
        result = await provider_request("GET", "/aspsps")
        items = result.get("aspsps", []) if isinstance(result, dict) else []
        return [{"name": bank["name"], "country": bank["country"]}
                for bank in items if bank.get("country") == country and bank.get("name")]

    @router.post("/banking/connect")
    async def start_connect(payload: NewConnection, user=Depends(require_banking)):
        require_provider(user)
        banks = await provider_request("GET", "/aspsps")
        if not any(b.get("name") == payload.institution and b.get("country") == payload.country
                   for b in banks.get("aspsps", [])):
            raise HTTPException(422, "Instituição não disponível no provedor")
        state = secrets.token_urlsafe(32)
        await db.bank_auth_states.insert_one({
            "state_hash": hashlib.sha256(state.encode()).hexdigest(),
            "user_id": user["id"], "institution": payload.institution,
            "country": payload.country, "expires_at": utcnow() + timedelta(minutes=10),
            "consumed": False,
        })
        # Consent validity is intentionally short; provider/bank may enforce less.
        body = {
            "access": {"valid_until": (utcnow() + timedelta(days=30)).isoformat()},
            "aspsp": {"name": payload.institution, "country": payload.country},
            "state": state,
            "redirect_url": os.environ["ENABLE_BANKING_CALLBACK_URL"],
            "psu_type": "personal",
            "psu_id": user["id"],
        }
        result = await provider_request("POST", "/auth", payload=body)
        url = result.get("url", "")
        # Redirect only to the provider's official authorization domain.
        if not re.match(r"^https://([a-z0-9-]+\.)*enablebanking\.com(/|$)", url):
            raise HTTPException(502, "URL de autorização bancária inválida")
        return {"authorization_url": url}

    @router.get("/banking/callback")
    async def callback(state: str = "", code: str = "", error: str = ""):
        require_provider()
        if not re.fullmatch(r"[A-Za-z0-9_-]{20,100}", state):
            raise HTTPException(400, "Estado de autorização inválido")
        state_hash = hashlib.sha256(state.encode()).hexdigest()
        record = await db.bank_auth_states.find_one_and_update(
            {"state_hash": state_hash, "consumed": False, "expires_at": {"$gt": utcnow()}},
            {"$set": {"consumed": True, "consumed_at": utcnow()}},
            return_document=ReturnDocument.AFTER,
        )
        if not record:
            raise HTTPException(400, "Autorização inválida, expirada ou utilizada")
        status = "error"
        if code and not error:
            # Re-check authorization on callback; revocation wins over prior consent.
            owner = await db.users.find_one({"id": record["user_id"]})
            if (owner and owner.get("status", "active") == "active"
                    and is_allowed(owner, is_super_admin)
                    and is_provider_eligible(owner, is_super_admin)):
                session = await provider_request("POST", "/sessions", payload={"code": code})
                if session.get("session_id") and session.get("accounts"):
                    accounts_data = {a.get("uid"): a.get("identification_hash")
                                     for a in session.get("accounts_data", [])}
                    await db.bank_connections.insert_one({
                        "id": str(uuid.uuid4()), "user_id": record["user_id"],
                        "institution": record["institution"], "country": record["country"],
                        "session_id": session["session_id"],
                        "status": "connected", "created_at": utcnow(),
                        "authorized_until": session.get("valid_until")
                                            or session.get("access", {}).get("valid_until"),
                        "accounts": [
                            {"uid": uid, "identification_hash": accounts_data.get(uid)}
                            for uid in session["accounts"]
                        ],
                    })
                    status = "connected"
        return RedirectResponse(os.environ["BANKING_RETURN_URL"] + "?" + urlencode({"banking": status}),
                                status_code=303)

    @router.get("/banking/connections")
    async def connections(user=Depends(require_banking)):
        items = await db.bank_connections.find(
            {"user_id": user["id"], "status": {"$ne": "deleted"}},
            {"_id": 0, "session_id": 0, "user_id": 0},
        ).sort("created_at", -1).to_list(length=50)
        return [public_connection(item) for item in items]

    @router.post("/banking/connections/{connection_id}/sync")
    async def sync_preview(connection_id: str, user=Depends(require_banking)):
        """Read-only POC: preview is isolated from wallet balances and ledger."""
        require_provider(user)
        item = await db.bank_connections.find_one({
            "id": connection_id, "user_id": user["id"], "status": "connected",
            "syncing": {"$ne": True},
        })
        if not item:
            raise HTTPException(404, "Conexão indisponível ou sincronização em andamento")
        last = item.get("last_sync_at")
        if isinstance(last, datetime) and utcnow() - last.replace(tzinfo=timezone.utc) < timedelta(hours=6):
            raise HTTPException(429, "Aguarde seis horas antes de sincronizar novamente")
        claimed = await db.bank_connections.find_one_and_update(
            {"id": connection_id, "user_id": user["id"],
             "status": "connected", "syncing": {"$ne": True}},
            {"$set": {"syncing": True}},
        )
        if not claimed:
            raise HTTPException(409, "Sincronização já iniciada")
        try:
            previews = []
            for acct in item.get("accounts", [])[:6]:
                uid = acct["uid"]
                balances = await provider_request("GET", f"/accounts/{uid}/balances")
                recent = await provider_request(
                    "GET", f"/accounts/{uid}/transactions",
                    params={"date_from": (utcnow() - timedelta(days=30)).date().isoformat(),
                            "date_to": utcnow().date().isoformat(), "transaction_status": "BOOK"},
                )
                # No ledger insertion; user must explicitly approve the reconciliation.
                previews.append({
                    "uid": uid, "identification_hash": acct.get("identification_hash"),
                    "balances": [
                        {"currency": b.get("balance_amount", {}).get("currency"),
                         "amount": b.get("balance_amount", {}).get("amount"),
                         "type": b.get("balance_type")}
                        for b in balances.get("balances", [])
                    ],
                    "transaction_count_first_page": len(recent.get("transactions", [])),
                    "has_more_transactions": bool(recent.get("continuation_key")),
                })
            await db.bank_connections.update_one(
                {"id": connection_id, "user_id": user["id"]},
                {"$set": {"last_sync_at": utcnow(), "last_preview": previews}},
            )
            return {"read_only": True, "accounts": previews,
                    "message": "Prévia consultada. Nenhum lançamento foi criado."}
        finally:
            await db.bank_connections.update_one(
                {"id": connection_id, "user_id": user["id"]}, {"$unset": {"syncing": ""}}
            )

    @router.delete("/banking/connections/{connection_id}")
    async def disconnect(connection_id: str, user=Depends(require_banking)):
        item = await db.bank_connections.find_one(
            {"id": connection_id, "user_id": user["id"], "status": {"$ne": "deleted"}}
        )
        if not item:
            raise HTTPException(404, "Conexão não encontrada")
        # Do not mark deleted on failure: the session could still be usable remotely.
        if item.get("session_id") and banking_configured():
            await provider_request("DELETE", "/sessions/" + item["session_id"])
        await db.bank_connections.update_one(
            {"id": connection_id, "user_id": user["id"]},
            {"$set": {"status": "deleted", "updated_at": utcnow()}, "$unset": {"session_id": ""}},
        )
        return {"disconnected": True}

    return router
