from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import json
import logging
import asyncio
import calendar
import hashlib
import secrets
import requests
import bcrypt
import jwt
import unicodedata
import statistics
import math
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal
from fastapi import (
    FastAPI, APIRouter, HTTPException, Depends, Request, WebSocket, BackgroundTasks,
    WebSocketDisconnect, UploadFile, File, Header, Query,
)
from fastapi.responses import Response
from fastapi.security import HTTPBearer
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from collections import defaultdict
from email_service import EmailService
from email_templates import validate_template_placeholders

# ---------- Config ----------
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]
email_service = EmailService(db)

DEFAULT_CORS_ORIGINS = (
    "https://www.crelithtech.com,"
    "https://crelithtech.com,"
    "https://aura-finance-inky.vercel.app,"
    "http://localhost:3000"
)
SUPER_ADMIN_EMAIL = "clementmarilia@gmail.com"


def configured_cors_origins() -> List[str]:
    raw_origins = os.environ.get("CORS_ORIGINS", DEFAULT_CORS_ORIGINS)
    return [
        origin.strip().rstrip("/")
        for origin in raw_origins.split(",")
        if origin.strip()
    ]


def configured_admin_emails() -> set[str]:
    raw_emails = os.environ.get(
        "ADMIN_EMAILS",
        "clementmarilia@gmail.com",
    )
    return {
        email.strip().lower()
        for email in raw_emails.split(",")
        if email.strip()
    }


def configured_super_admin_email() -> str:
    return SUPER_ADMIN_EMAIL


app = FastAPI(title="Controle Financeiro")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("finance")

SUPPORTED_CURRENCIES = ("EUR", "BRL", "USD", "CHF")
PRIVACY_NOTICE_VERSION = "2026-07-23"
FX_API_URL = "https://api.frankfurter.dev/v2/rates"
_fx_cache = {}


def normalize_currency(value: Optional[str], fallback: str = "EUR") -> str:
    currency = (value or fallback).upper()
    if currency not in SUPPORTED_CURRENCIES:
        raise HTTPException(400, f"Moeda não suportada: {currency}")
    return currency


async def fetch_currency_snapshot(base_currency: str, rate_date: Optional[str] = None) -> dict:
    """Return conversion rates from one currency to every supported currency."""
    base = normalize_currency(base_currency)
    day = (rate_date or datetime.now(timezone.utc).date().isoformat())[:10]
    try:
        requested_date = datetime.strptime(day, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "Data inválida para cotação")
    today = datetime.now(timezone.utc).date()
    lookup_day = min(requested_date, today).isoformat()
    cache_key = (base, day)
    if cache_key in _fx_cache:
        return dict(_fx_cache[cache_key])
    quotes = [currency for currency in SUPPORTED_CURRENCIES if currency != base]

    def _request():
        response = requests.get(
            FX_API_URL,
            params={"base": base, "quotes": ",".join(quotes), "date": lookup_day},
            timeout=8,
        )
        response.raise_for_status()
        return response.json()

    try:
        rows = await asyncio.to_thread(_request)
        rates = {base: 1.0}
        effective_date = lookup_day
        for row in rows if isinstance(rows, list) else []:
            quote = row.get("quote")
            if quote in SUPPORTED_CURRENCIES:
                rates[quote] = float(row["rate"])
                effective_date = row.get("date") or effective_date
        if not all(currency in rates for currency in SUPPORTED_CURRENCIES):
            raise ValueError("Resposta de câmbio incompleta")
    except Exception as exc:
        logger.warning("Exchange-rate lookup failed for %s on %s: %s", base, day, exc)
        raise HTTPException(
            503,
            "Não foi possível obter a cotação automática. Tente novamente ou informe a cotação manualmente.",
        )

    snapshot = {
        "base": base,
        "date": effective_date,
        "requested_date": day,
        "estimated": effective_date != day,
        "rates": rates,
        "source": "frankfurter",
    }
    _fx_cache[cache_key] = snapshot
    return dict(snapshot)


def amount_in_currency(doc: dict, target_currency: str, amount_key: str = "amount") -> float:
    """Convert a stored original amount using its immutable exchange-rate snapshot."""
    amount = float(doc.get(amount_key) or 0)
    target = normalize_currency(target_currency)
    source = normalize_currency(doc.get("currency"), target)
    if source == target:
        return amount
    rates = doc.get("exchange_rates") or {}
    if target in rates:
        return amount * float(rates[target])
    if doc.get("base_currency_at_creation") == target and doc.get("exchange_rate_to_base"):
        return amount * float(doc["exchange_rate_to_base"])
    # Records created before multimoeda were expressed in the user's base currency.
    return amount


def rate_for_new_base(
    doc: dict,
    old_currency: str,
    new_currency: str,
    old_to_new_rate: float,
) -> Optional[float]:
    """Derive a missing immutable rate when the user changes base currency."""
    old = normalize_currency(old_currency)
    new = normalize_currency(new_currency)
    source = normalize_currency(doc.get("currency"), old)
    rates = doc.get("exchange_rates") or {}
    if new in rates:
        return float(rates[new])
    if source == new:
        return 1.0
    if old in rates:
        return float(rates[old]) * float(old_to_new_rate)
    if doc.get("base_currency_at_creation") == old and doc.get("exchange_rate_to_base"):
        return float(doc["exchange_rate_to_base"]) * float(old_to_new_rate)
    if source == old:
        return float(old_to_new_rate)
    return None


async def monetary_metadata(
    currency: str,
    base_currency: str,
    rate_date: Optional[str] = None,
    manual_rate_to_base: Optional[float] = None,
) -> dict:
    source = normalize_currency(currency)
    base = normalize_currency(base_currency)
    if source == base:
        snapshot = {
            "base": source,
            "date": (rate_date or datetime.now(timezone.utc).date().isoformat())[:10],
            "rates": {source: 1.0},
            "source": "same_currency",
        }
    else:
        try:
            snapshot = await fetch_currency_snapshot(source, rate_date)
        except HTTPException:
            if not manual_rate_to_base or manual_rate_to_base <= 0:
                raise
            snapshot = {
                "base": source,
                "date": (rate_date or datetime.now(timezone.utc).date().isoformat())[:10],
                "rates": {source: 1.0},
                "source": "manual",
            }
    rates = dict(snapshot["rates"])
    if manual_rate_to_base is not None:
        if manual_rate_to_base <= 0:
            raise HTTPException(400, "A cotação deve ser maior que zero")
        rates[base] = float(manual_rate_to_base)
    if base not in rates:
        raise HTTPException(
            503,
            "Não foi possível obter uma cotação válida. Informe a cotação manualmente.",
        )
    return {
        "currency": source,
        "exchange_rates": rates,
        "base_currency_at_creation": base,
        "exchange_rate_to_base": float(rates[base]),
        "rate_date": snapshot["date"],
        "rate_source": "manual" if manual_rate_to_base is not None else snapshot["source"],
    }
@app.get("/api/health", tags=["health"])
async def health_check():
    """Health check used by Render without exposing database details."""
    try:
        await db.command("ping")
    except Exception as exc:
        logger.error("MongoDB health check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Serviço temporariamente indisponível")
    return {"status": "ok"}

# ---------- Object Storage ----------
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "aurea-financas"
_storage_key = None
MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp", "pdf": "application/pdf",
}


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def _get_object(path: str):
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=60,
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")



# ---------- Realtime (WebSocket) ----------
NOTIF_TYPES = ["shared_expense_added", "settlement_paid", "nudge", "group_added"]
WS_TICKET_TTL_SECONDS = 30
WS_AUTH_TIMEOUT_SECONDS = 10


class ConnectionManager:
    def __init__(self):
        self.active = defaultdict(set)

    def connect(self, user_id: str, ws: WebSocket):
        self.active[user_id].add(ws)

    def disconnect(self, user_id: str, ws: WebSocket):
        self.active[user_id].discard(ws)
        if not self.active[user_id]:
            self.active.pop(user_id, None)

    async def send(self, user_id: str, data: dict):
        for ws in list(self.active.get(user_id, [])):
            try:
                await ws.send_json(data)
            except Exception:
                self.active[user_id].discard(ws)

    async def disconnect_user(self, user_id: str, code: int = 1008):
        sockets = list(self.active.pop(user_id, set()))
        for ws in sockets:
            try:
                await ws.close(code=code)
            except Exception:
                pass


ws_manager = ConnectionManager()


def hash_ws_ticket(ticket: str) -> str:
    return hashlib.sha256(ticket.encode()).hexdigest()


def websocket_origin_allowed(origin: Optional[str]) -> bool:
    normalized = (origin or "").rstrip("/")
    return bool(normalized) and normalized in configured_cors_origins()


async def consume_ws_ticket(ticket: str) -> tuple[Optional[dict], str]:
    if not isinstance(ticket, str) or not 32 <= len(ticket) <= 256:
        return None, "invalid_ticket"

    now = datetime.now(timezone.utc)
    ticket_doc = await db.websocket_tickets.find_one({
        "ticket_hash": hash_ws_ticket(ticket),
        "used_at": None,
        "expires_at": {"$gt": now},
    })
    if not ticket_doc:
        return None, "invalid_ticket"

    claimed = await db.websocket_tickets.update_one(
        {
            "id": ticket_doc["id"],
            "used_at": None,
            "expires_at": {"$gt": now},
        },
        {"$set": {"used_at": now}},
    )
    if not claimed.modified_count:
        return None, "invalid_ticket"

    user = await db.users.find_one(
        {"id": ticket_doc["user_id"]},
        {"_id": 0, "password_hash": 0},
    )
    if not user:
        return None, "invalid_session"
    if int(ticket_doc.get("session_version", 0)) != int(
        user.get("session_version", 0)
    ):
        return None, "invalid_session"
    try:
        ensure_active_user(user)
    except HTTPException:
        return None, "invalid_session"
    return user, "ok"


# ---------- Helpers ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def category_display_name(value: object) -> str:
    return " ".join(str(value or "").split())


def category_name_key(value: object) -> str:
    normalized = unicodedata.normalize(
        "NFKD",
        category_display_name(value).casefold(),
    )
    return "".join(
        char for char in normalized
        if not unicodedata.combining(char)
    )


async def category_name_exists(
    user_id: str,
    name_key: str,
    exclude_id: Optional[str] = None,
) -> bool:
    query = {"user_id": user_id}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    async for category in db.categories.find(
        query,
        {"name": 1, "name_key": 1},
    ):
        existing_key = (
            category.get("name_key")
            or category_name_key(category.get("name"))
        )
        if existing_key == name_key:
            return True
    return False


def idempotency_fingerprint(payload: dict) -> str:
    serialized = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


async def run_idempotent_create(
    operation: str,
    owner_id: str,
    idempotency_key: Optional[str],
    payload: dict,
    create,
):
    """Run a create operation once while keeping legacy clients compatible."""
    key = (idempotency_key or "").strip()
    if not key:
        return await create()
    if not 16 <= len(key) <= 200:
        raise HTTPException(400, "Idempotency-Key inválida")

    fingerprint = idempotency_fingerprint(payload)
    claim = {
        "operation": operation,
        "owner_id": owner_id,
        "key": key,
        "fingerprint": fingerprint,
        "status": "processing",
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    }
    try:
        await db.idempotency_requests.insert_one(claim)
    except DuplicateKeyError:
        existing = await db.idempotency_requests.find_one(
            {"operation": operation, "owner_id": owner_id, "key": key},
            {"_id": 0},
        )
        if not existing:
            raise HTTPException(409, "Operação já está sendo processada")
        if existing.get("fingerprint") != fingerprint:
            raise HTTPException(
                409,
                "A mesma Idempotency-Key não pode ser usada com dados diferentes",
            )
        for _ in range(50):
            if existing.get("status") == "completed":
                return existing.get("response")
            await asyncio.sleep(0.1)
            existing = await db.idempotency_requests.find_one(
                {"operation": operation, "owner_id": owner_id, "key": key},
                {"_id": 0},
            )
            if not existing:
                break
        raise HTTPException(409, "Operação já está sendo processada")

    try:
        response = await create()
    except Exception:
        await db.idempotency_requests.delete_one({
            "operation": operation,
            "owner_id": owner_id,
            "key": key,
            "status": "processing",
        })
        raise

    await db.idempotency_requests.update_one(
        {"operation": operation, "owner_id": owner_id, "key": key},
        {"$set": {
            "status": "completed",
            "response": response,
            "completed_at": datetime.now(timezone.utc),
        }},
    )
    return response


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str, email: str, session_version: int = 0) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "ver": session_version,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def account_status(user: dict) -> str:
    """Existing users predate approval and remain active by default."""
    return user.get("status") or "active"


def user_role(user: dict) -> str:
    """Resolve persisted RBAC roles while keeping legacy administrators active."""
    email = user.get("email", "").strip().lower()
    if email == configured_super_admin_email():
        return "SUPER_ADMIN"
    stored_role = str(user.get("role") or "").upper()
    if stored_role in {"USER", "ADMIN"}:
        return stored_role
    if email in configured_admin_emails():
        return "ADMIN"
    return "USER"


def is_admin_user(user: dict) -> bool:
    return user_role(user) in {"ADMIN", "SUPER_ADMIN"}


def is_super_admin_user(user: dict) -> bool:
    return user_role(user) == "SUPER_ADMIN"


def ensure_active_user(user: dict) -> dict:
    if user.get("deletion_in_progress"):
        raise HTTPException(status_code=403, detail="Conta em processo de exclusão")
    status = account_status(user)
    if status == "pending":
        raise HTTPException(
            status_code=403,
            detail="Cadastro aguardando aprovação da administradora",
        )
    if status == "rejected":
        raise HTTPException(
            status_code=403,
            detail="Cadastro não aprovado. Entre em contato com a administradora.",
        )
    if status != "active":
        raise HTTPException(status_code=403, detail="Conta indisponível")
    return user


async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Não autenticado")
    token = auth[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    if int(payload.get("ver", 0)) != int(user.get("session_version", 0)):
        raise HTTPException(status_code=401, detail="Sessão invalidada")
    return ensure_active_user(user)


async def require_admin(user=Depends(get_current_user)) -> dict:
    if not is_admin_user(user):
        raise HTTPException(
            status_code=403,
            detail="Acesso restrito à administradora",
        )
    return user


async def require_super_admin(user=Depends(get_current_user)) -> dict:
    if not is_super_admin_user(user):
        raise HTTPException(
            status_code=403,
            detail="Somente a super administradora pode alterar papéis administrativos",
        )
    return user


def month_range(year: int, month: int):
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start.isoformat(), end.isoformat()


def month_end_date(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


# ---------- Models ----------
class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    password: str
    currency: str = "EUR"
    language: Literal["pt", "it", "en", "es"] = "pt"
    privacy_acknowledged: Literal[True]


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    currency: str
    avatar_color: str
    created_at: str
    language: Literal["pt", "it", "en", "es"] = "pt"


class AdminUserOut(BaseModel):
    id: str
    name: str
    email: str
    status: Literal["pending", "active", "inactive", "rejected"]
    role: Literal["USER", "ADMIN", "SUPER_ADMIN"] = "USER"
    is_super_admin: bool = False
    created_at: str
    reviewed_at: Optional[str] = None


class AdminUserDeletionImpactOut(BaseModel):
    user: AdminUserOut
    can_delete: bool
    blockers: List[str]
    impact: dict[str, int]
    sessions_will_be_terminated: bool = True


class AdminRoleUpdateIn(BaseModel):
    role: Literal["USER", "ADMIN"]


class AdminStatusUpdateIn(BaseModel):
    status: Literal["active", "inactive"]


class AdminIdentityUpdateIn(BaseModel):
    name: str


class UpdateProfileIn(BaseModel):
    name: Optional[str] = None
    currency: Optional[str] = None
    language: Optional[Literal["pt", "it", "en", "es"]] = None


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class PasswordResetRequestIn(BaseModel):
    email: EmailStr


class PasswordResetIn(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    new_password: str = Field(min_length=8, max_length=128)


class PasswordResetTokenIn(BaseModel):
    token: str = Field(min_length=32, max_length=256)


class TransactionalEmailSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    registration_enabled: bool = True
    welcome_enabled: bool = True
    password_reset_enabled: bool = True
    from_name: str = Field(min_length=1, max_length=80)
    from_email: EmailStr
    reply_to: Optional[EmailStr] = None
    logo_url: str = Field(
        default="https://www.crelithtech.com/logo-full-dark.png",
        min_length=10,
        max_length=500,
    )
    reset_url: str = Field(min_length=10, max_length=500)
    reset_expires_minutes: int = Field(ge=10, le=120)


class TransactionalEmailTestIn(BaseModel):
    recipient: EmailStr
    language: Literal["pt", "it", "en", "es"] = "pt"


class EmailTemplateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str = Field(min_length=1, max_length=180)
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=5000)
    button_text: str = Field(default="", max_length=120)
    button_url: str = Field(default="", max_length=500)
    footer: str = Field(default="", max_length=1500)


class AccountDeletionIn(BaseModel):
    password: str
    confirmation: str


class AccountDeletionImpactOut(BaseModel):
    can_delete: bool
    blockers: List[str]
    impact: dict[str, int]
    shared_history_will_be_anonymized: bool = True
    sessions_will_be_terminated: bool = True


class CategoryIn(BaseModel):
    name: str
    icon: Optional[str] = "tag"
    color: Optional[str] = "#1E3F33"
    kind: Literal["expense", "income", "both"] = "expense"


class AccountIn(BaseModel):
    name: str
    type: Literal["checking", "savings", "cash", "card", "investment", "other"] = "checking"
    initial_balance: float = 0.0
    currency: Optional[str] = None


class AccountReconciliationIn(BaseModel):
    actual_balance: float
    expected_balance: float
    note: str = Field(default="", max_length=500)


class AccountReconciliationUpdateIn(BaseModel):
    actual_balance: float
    note: str = Field(default="", max_length=500)


class TransactionIn(BaseModel):
    type: Literal["income", "expense", "transfer"]
    date: str  # ISO date
    amount: float
    category_id: Optional[str] = None
    person_id: Optional[str] = None
    account_id: Optional[str] = None
    from_account_id: Optional[str] = None
    to_account_id: Optional[str] = None
    payment_method: Optional[str] = None
    description: str = ""
    notes: str = ""
    status: Literal["paid", "pending", "cancelled"] = "paid"
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None
    target_amount: Optional[float] = None
    rate_source: Optional[Literal["automatic", "manual"]] = None


class InstallmentPurchaseIn(BaseModel):
    description: str
    total_amount: float
    installments: int
    first_date: str  # ISO date
    category_id: Optional[str] = None
    payment_method: Optional[str] = None
    account_id: Optional[str] = None
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None


class ReceivableIn(BaseModel):
    person: str
    amount: float
    due_date: str
    description: str = ""
    account_id: Optional[str] = None
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None


class GroupIn(BaseModel):
    name: str
    description: str = ""
    member_emails: List[EmailStr] = []


class GroupMemberRoleIn(BaseModel):
    role: Literal["admin", "member"]


class PersonIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: Optional[EmailStr] = None
    nickname: str = Field(default="", max_length=120)
    relationship: str = Field(default="", max_length=80)
    notes: str = Field(default="", max_length=1000)


class ParticipantSplit(BaseModel):
    user_id: Optional[str] = None
    person_id: Optional[str] = None
    amount: Optional[float] = None
    percent: Optional[float] = None


class SharedExpenseIn(BaseModel):
    title: str
    amount: float
    date: str
    category: str = "Outros"
    category_id: Optional[str] = None
    payer_id: str
    participants: List[ParticipantSplit]
    split_type: Literal["equal", "manual", "percent"] = "equal"
    group_id: Optional[str] = None
    account_id: Optional[str] = None
    notes: str = ""
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None


class SharedExpenseAccountIn(BaseModel):
    account_id: str


class ReportFiltersIn(BaseModel):
    description: str = Field(default="", max_length=120)
    category_ids: List[str] = Field(default_factory=list)
    participant_ids: List[str] = Field(default_factory=list)
    statuses: List[Literal["paid", "pending", "overdue", "completed"]] = Field(default_factory=list)
    types: List[Literal[
        "income", "expense", "transfer", "shared_expense", "settlement"
    ]] = Field(default_factory=list)
    period: Literal["all", "date", "month", "year", "range"] = "all"
    specific_date: Optional[str] = None
    month: Optional[str] = None
    year: Optional[int] = Field(default=None, ge=1900, le=2200)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    account_ids: List[str] = Field(default_factory=list)
    currencies: List[str] = Field(default_factory=list)


# ---------- Defaults ----------
DEFAULT_CATEGORIES = [
    ("Moradia", "home", "#1E3F33", "expense"),
    ("Mercado", "shopping-cart", "#D96C5B", "expense"),
    ("Transporte", "car", "#E5A83B", "expense"),
    ("Saúde", "heart-pulse", "#D9453B", "expense"),
    ("Educação", "graduation-cap", "#3B82F6", "expense"),
    ("Lazer", "gamepad-2", "#7EA193", "expense"),
    ("Assinaturas", "repeat", "#C7BCA1", "expense"),
    ("Contas fixas", "file-text", "#2C5C4A", "expense"),
    ("Compras", "shopping-bag", "#D96C5B", "expense"),
    ("Viagem", "plane", "#E5A83B", "expense"),
    ("Outros", "more-horizontal", "#6B7068", "expense"),
    # Receita
    ("Salário", "wallet", "#2C7A51", "income"),
    ("Freelance / Extra", "briefcase", "#1E3F33", "income"),
    ("Investimentos", "trending-up", "#3B82F6", "income"),
    ("Presente / Reembolso", "gift", "#E5A83B", "income"),
    ("Outras receitas", "more-horizontal", "#7EA193", "income"),
]


async def seed_user_defaults(user_id: str, currency: str = "EUR"):
    existing_name_keys = set()
    async for category in db.categories.find(
        {"user_id": user_id},
        {"name": 1, "name_key": 1},
    ):
        existing_name_keys.add(
            category.get("name_key")
            or category_name_key(category.get("name"))
        )

    for name, icon, color, kind in DEFAULT_CATEGORIES:
        name_key = category_name_key(name)
        if name_key in existing_name_keys:
            continue
        await db.categories.insert_one({
            "id": new_id(), "user_id": user_id, "name": name,
            "name_key": name_key,
            "icon": icon, "color": color, "kind": kind,
            "is_default": True, "created_at": now_iso(),
        })
        existing_name_keys.add(name_key)
    if not await db.accounts.find_one({"user_id": user_id}):
        await db.accounts.insert_one({
            "id": new_id(), "user_id": user_id, "name": "Conta Principal",
            "type": "checking", "initial_balance": 0.0,
            "currency": normalize_currency(currency), "created_at": now_iso(),
        })


def user_color(name: str) -> str:
    palette = ["#1E3F33", "#D96C5B", "#E5A83B", "#7EA193", "#3B82F6", "#C7BCA1"]
    return palette[sum(ord(c) for c in name) % len(palette)]


def public_user(u: dict) -> dict:
    role = user_role(u)
    return {
        "id": u["id"], "name": u["name"], "email": u["email"],
        "currency": u.get("currency", "EUR"),
        "language": u.get("language", "pt"),
        "avatar_color": u.get("avatar_color", "#1E3F33"),
        "created_at": u.get("created_at", ""),
        "status": account_status(u),
        "role": role,
        "is_admin": role in {"ADMIN", "SUPER_ADMIN"},
        "is_super_admin": role == "SUPER_ADMIN",
    }


def deleted_user_summary(user_id: str, language: str = "pt") -> dict:
    deleted_names = {
        "pt": "Usuário excluído",
        "it": "Utente eliminato",
        "en": "Deleted user",
        "es": "Usuario eliminado",
    }
    return {
        "id": user_id,
        "name": deleted_names.get(language, deleted_names["pt"]),
        "email": "",
        "currency": "EUR",
        "language": "pt",
        "avatar_color": "#6B7068",
        "created_at": "",
        "status": "inactive",
        "role": "USER",
        "is_admin": False,
        "is_super_admin": False,
    }


def admin_user_summary(u: dict) -> dict:
    """Return identity and approval metadata only, never financial data."""
    role = user_role(u)
    return {
        "id": u["id"],
        "name": u["name"],
        "email": u["email"],
        "status": account_status(u),
        "role": role,
        "is_super_admin": role == "SUPER_ADMIN",
        "created_at": u.get("created_at", ""),
        "reviewed_at": u.get("reviewed_at"),
    }


# ---------- Auth ----------
@api.post("/auth/register")
async def register(
    payload: RegisterIn,
    background_tasks: BackgroundTasks,
):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")
    uid = new_id()
    currency = normalize_currency(payload.currency)
    user = {
        "id": uid, "name": payload.name, "email": email,
        "password_hash": hash_password(payload.password),
        "currency": currency, "avatar_color": user_color(payload.name),
        "language": payload.language,
        "role": "USER",
        "status": "pending",
        "privacy_acknowledged_at": now_iso(),
        "privacy_notice_version": PRIVACY_NOTICE_VERSION,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    background_tasks.add_task(email_service.send_registration_received_email, user)
    return {
        "status": "pending",
        "email": email,
        "message": "Cadastro enviado para aprovação",
    }


@api.post("/auth/login")
async def login(payload: LoginIn):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    ensure_active_user(user)
    token = create_token(user["id"], email, int(user.get("session_version", 0)))
    return {"token": token, "user": public_user(user)}


@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return public_user(user)


@api.put("/auth/profile")
async def update_profile(payload: UpdateProfileIn, user=Depends(get_current_user)):
    upd = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if "currency" in upd:
        new_currency = normalize_currency(upd["currency"])
        old_currency = normalize_currency(user.get("currency"))
        upd["currency"] = new_currency
        if new_currency != old_currency:
            snapshot = await fetch_currency_snapshot(old_currency)
            old_to_new_rate = snapshot["rates"][new_currency]
            legacy_meta = {
                "currency": old_currency,
                "exchange_rates": snapshot["rates"],
                "base_currency_at_creation": old_currency,
                "exchange_rate_to_base": 1.0,
                "rate_date": snapshot["date"],
                "rate_source": "legacy_backfill",
            }
            collections = [
                ("accounts", "user_id"),
                ("transactions", "user_id"),
                ("recurrences", "user_id"),
                ("installment_purchases", "user_id"),
                ("receivables", "user_id"),
                ("goals", "user_id"),
                ("shared_expenses", "creator_id"),
            ]
            for collection_name, owner_field in collections:
                collection = db[collection_name]
                owner_filter = {owner_field: user["id"]}
                await collection.update_many(
                    {**owner_filter, "currency": {"$exists": False}},
                    {"$set": legacy_meta},
                )
                missing = await collection.find(
                    {**owner_filter, f"exchange_rates.{new_currency}": {"$exists": False}},
                    {"_id": 0},
                ).to_list(20000)
                for doc in missing:
                    rate = rate_for_new_base(
                        doc, old_currency, new_currency, old_to_new_rate)
                    if rate is None:
                        source = normalize_currency(doc.get("currency"), old_currency)
                        source_snapshot = await fetch_currency_snapshot(
                            source, doc.get("rate_date"))
                        rate = source_snapshot["rates"][new_currency]
                    await collection.update_one(
                        {**owner_filter, "id": doc["id"]},
                        {"$set": {f"exchange_rates.{new_currency}": float(rate)}},
                    )
    if upd:
        await db.users.update_one({"id": user["id"]}, {"$set": upd})
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return public_user(u)


@api.post("/auth/change-password")
async def change_password(payload: ChangePasswordIn, user=Depends(get_current_user)):
    u = await db.users.find_one({"id": user["id"]})
    if not verify_password(payload.current_password, u["password_hash"]):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {"password_hash": hash_password(payload.new_password)},
            "$inc": {"session_version": 1},
        },
    )
    await db.password_reset_tokens.update_many(
        {"user_id": user["id"], "used_at": None},
        {"$set": {"used_at": now_iso(), "invalidated_reason": "password_changed"}},
    )
    await ws_manager.disconnect_user(user["id"], code=4003)
    return {"ok": True}


# ---------- Password recovery via transactional email ----------
PASSWORD_RESET_GENERIC_MESSAGE = (
    "Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha."
)
PASSWORD_RESET_RATE_LIMIT = 3
PASSWORD_RESET_RATE_WINDOW_MINUTES = 60
PASSWORD_RESET_MIN_RESPONSE_SECONDS = 0.25


def hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def request_fingerprint(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    host = forwarded.split(",")[0].strip() if forwarded else ""
    if not host and request.client:
        host = request.client.host
    return hashlib.sha256(f"{JWT_SECRET}:{host or 'unknown'}".encode()).hexdigest()


async def password_reset_rate_limited(email: str, fingerprint: str) -> bool:
    cutoff = (
        datetime.now(timezone.utc)
        - timedelta(minutes=PASSWORD_RESET_RATE_WINDOW_MINUTES)
    )
    query = {
        "created_at": {"$gte": cutoff},
        "$or": [
            {"email_hash": hashlib.sha256(email.encode()).hexdigest()},
            {"request_fingerprint": fingerprint},
        ],
    }
    return (
        await db.password_reset_requests.count_documents(query)
        >= PASSWORD_RESET_RATE_LIMIT
    )


@api.post("/auth/password-reset/request")
async def request_password_reset(
    payload: PasswordResetRequestIn,
    request: Request,
    background_tasks: BackgroundTasks,
):
    started_at = asyncio.get_running_loop().time()
    email = payload.email.lower()
    fingerprint = request_fingerprint(request)
    email_hash = hashlib.sha256(email.encode()).hexdigest()
    if await password_reset_rate_limited(email, fingerprint):
        logger.warning("Password reset rate limit reached: email_hash=%s", email_hash)
        await asyncio.sleep(max(
            0,
            PASSWORD_RESET_MIN_RESPONSE_SECONDS
            - (asyncio.get_running_loop().time() - started_at),
        ))
        return {"ok": True, "message": PASSWORD_RESET_GENERIC_MESSAGE}

    user = await db.users.find_one({"email": email})
    await db.password_reset_requests.insert_one({
        "id": new_id(),
        "user_id": user.get("id") if user else None,
        "email_hash": email_hash,
        "request_fingerprint": fingerprint,
        "created_at": datetime.now(timezone.utc),
    })
    if user:
        issued_at = datetime.now(timezone.utc)
        settings = await email_service.public_settings()
        expires_at = issued_at + timedelta(
            minutes=settings["reset_expires_minutes"]
        )
        raw_token = secrets.token_urlsafe(48)
        await db.password_reset_tokens.update_many(
            {"user_id": user["id"], "used_at": None},
            {
                "$set": {
                    "used_at": issued_at.isoformat(),
                    "invalidated_reason": "superseded",
                }
            },
        )
        await db.password_reset_tokens.insert_one({
            "id": new_id(),
            "user_id": user["id"],
            "token_hash": hash_reset_token(raw_token),
            "expires_at": expires_at,
            "used_at": None,
            "created_at": issued_at.isoformat(),
        })
        background_tasks.add_task(
            email_service.send_password_reset_email,
            user,
            raw_token,
        )
    await asyncio.sleep(max(
        0,
        PASSWORD_RESET_MIN_RESPONSE_SECONDS
        - (asyncio.get_running_loop().time() - started_at),
    ))
    return {"ok": True, "message": PASSWORD_RESET_GENERIC_MESSAGE}


async def valid_password_reset_token(token: str) -> Optional[dict]:
    token_doc = await db.password_reset_tokens.find_one({
        "token_hash": hash_reset_token(token),
        "used_at": None,
        "expires_at": {"$gt": datetime.now(timezone.utc)},
    })
    if not token_doc:
        return None
    user = await db.users.find_one({"id": token_doc["user_id"]})
    if not user:
        return None
    return token_doc


@api.post("/auth/password-reset/validate")
async def validate_password_reset_token(payload: PasswordResetTokenIn):
    if not await valid_password_reset_token(payload.token):
        raise HTTPException(400, "Link inválido ou expirado")
    return {"valid": True}


@api.post("/auth/password-reset/confirm")
async def confirm_password_reset(payload: PasswordResetIn):
    token_hash = hash_reset_token(payload.token)
    token_doc = await valid_password_reset_token(payload.token)
    if not token_doc:
        raise HTTPException(400, "Link inválido ou expirado")

    used_at = now_iso()
    claimed = await db.password_reset_tokens.update_one(
        {
            "id": token_doc["id"],
            "token_hash": token_hash,
            "used_at": None,
            "expires_at": {"$gt": datetime.now(timezone.utc)},
        },
        {"$set": {"used_at": used_at, "invalidated_reason": "used"}},
    )
    if claimed.modified_count != 1:
        raise HTTPException(400, "Link inválido ou expirado")

    await db.users.update_one(
        {"id": token_doc["user_id"]},
        {
            "$set": {
                "password_hash": hash_password(payload.new_password),
                "password_updated_at": used_at,
            },
            "$inc": {"session_version": 1},
        },
    )
    await db.password_reset_tokens.update_many(
        {"user_id": token_doc["user_id"], "used_at": None},
        {"$set": {"used_at": used_at, "invalidated_reason": "password_reset"}},
    )
    await ws_manager.disconnect_user(token_doc["user_id"], code=4003)
    return {"ok": True}


# ---------- Transactional email administration (non-secret settings only) ----------
@api.get("/admin/email-settings")
async def get_transactional_email_settings(
    _super_admin=Depends(require_super_admin),
):
    return await email_service.public_settings()


@api.put("/admin/email-settings")
async def update_transactional_email_settings(
    payload: TransactionalEmailSettingsIn,
    super_admin=Depends(require_super_admin),
):
    if not payload.reset_url.lower().startswith("https://"):
        raise HTTPException(400, "O link de recuperação deve usar HTTPS")
    if (
        not payload.logo_url.lower().startswith("https://")
        or "\r" in payload.logo_url
        or "\n" in payload.logo_url
    ):
        raise HTTPException(400, "A imagem da logo deve usar HTTPS")
    if "\r" in payload.from_name or "\n" in payload.from_name:
        raise HTTPException(400, "Nome do remetente inválido")
    settings = payload.model_dump(mode="json")
    if not settings.get("reply_to"):
        settings["reply_to"] = ""
    settings.update({
        "id": "transactional_email",
        "updated_at": now_iso(),
        "updated_by": super_admin["id"],
    })
    await db.app_settings.update_one(
        {"id": "transactional_email"},
        {"$set": settings},
        upsert=True,
    )
    return await email_service.public_settings()


@api.post("/admin/email-settings/test")
async def send_transactional_email_test(
    payload: TransactionalEmailTestIn,
    _super_admin=Depends(require_super_admin),
):
    if not email_service.is_configured():
        raise HTTPException(503, "A credencial do Resend não está configurada no servidor")
    sent = await email_service.send_test_email(
        str(payload.recipient).lower(),
        payload.language,
    )
    if not sent:
        raise HTTPException(502, "O provedor não aceitou o e-mail de teste")
    return {"ok": True}


def validate_email_template_payload(
    template_type: str,
    payload: EmailTemplateIn,
) -> dict:
    fields = payload.model_dump()
    for key, value in fields.items():
        if "\x00" in value:
            raise HTTPException(400, f"Campo inválido: {key}")
    if "\r" in fields["subject"] or "\n" in fields["subject"]:
        raise HTTPException(400, "O assunto deve ter apenas uma linha")
    button_url = fields["button_url"].strip()
    if template_type == "password_reset":
        fields["button_url"] = ""
    elif button_url and not button_url.lower().startswith("https://"):
        raise HTTPException(400, "O link do botão deve usar HTTPS")
    try:
        validate_template_placeholders(template_type, fields)
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, str(exc))
    return fields


@api.get("/admin/email-templates")
async def get_email_templates(
    _super_admin=Depends(require_super_admin),
):
    return {"templates": await email_service.public_templates()}


@api.put("/admin/email-templates/{template_type}/{language}")
async def update_email_template(
    template_type: Literal["registration_received", "welcome", "password_reset"],
    language: Literal["pt", "it", "en", "es"],
    payload: EmailTemplateIn,
    super_admin=Depends(require_super_admin),
):
    fields = validate_email_template_payload(template_type, payload)
    document = {
        "id": f"{template_type}:{language}",
        "template_type": template_type,
        "language": language,
        **fields,
        "updated_at": now_iso(),
        "updated_by": super_admin["id"],
    }
    await db.email_templates.update_one(
        {"id": document["id"]},
        {"$set": document},
        upsert=True,
    )
    return await email_service.template_fields(template_type, language)


@api.delete("/admin/email-templates/{template_type}/{language}")
async def restore_default_email_template(
    template_type: Literal["registration_received", "welcome", "password_reset"],
    language: Literal["pt", "it", "en", "es"],
    _super_admin=Depends(require_super_admin),
):
    await db.email_templates.delete_one({"id": f"{template_type}:{language}"})
    return await email_service.template_fields(template_type, language)


@api.post("/admin/email-templates/{template_type}/{language}/preview")
async def preview_email_template(
    template_type: Literal["registration_received", "welcome", "password_reset"],
    language: Literal["pt", "it", "en", "es"],
    payload: EmailTemplateIn,
    _super_admin=Depends(require_super_admin),
):
    fields = validate_email_template_payload(template_type, payload)
    subject, html = await email_service.render_template(
        template_type,
        language,
        fields,
    )
    return {"subject": subject, "html": html}


@api.get("/users/search")
async def search_users(email: str, user=Depends(get_current_user)):
    u = await db.users.find_one(
        {
            "email": email.lower(),
            "deletion_in_progress": {"$ne": True},
            "$or": [
                {"status": "active"},
                {"status": {"$exists": False}},
            ],
        },
        {"_id": 0, "password_hash": 0},
    )
    if not u:
        return None
    return public_user(u)


# ---------- User approval administration ----------
FINANCIAL_DELETION_BLOCKERS = (
    "income",
    "expenses",
    "transfers",
    "wallets",
    "balance_adjustments",
    "goals",
    "shared_expenses",
    "pending_settlements",
    "recurrences",
    "installment_purchases",
    "receivables",
    "groups_created",
)


async def user_financial_impact(user_id: str) -> dict[str, int]:
    shared_query = {
        "$or": [
            {"participant_ids": user_id},
            {"creator_id": user_id},
            {"payer_id": user_id},
        ],
    }
    (
        income,
        expenses,
        transfers,
        wallets,
        balance_adjustments,
        goals,
        shared_expenses,
        recurrences,
        installment_purchases,
        receivables,
        groups_created,
        shared_items,
    ) = await asyncio.gather(
        db.transactions.count_documents({"user_id": user_id, "type": "income"}),
        db.transactions.count_documents({"user_id": user_id, "type": "expense"}),
        db.transactions.count_documents({"user_id": user_id, "type": "transfer"}),
        db.accounts.count_documents({
            "user_id": user_id,
            "$or": [
                {"initial_balance": {"$gt": 0}},
                {"initial_balance": {"$lt": 0}},
            ],
        }),
        db.account_adjustments.count_documents({"user_id": user_id}),
        db.goals.count_documents({"user_id": user_id}),
        db.shared_expenses.count_documents(shared_query),
        db.recurrences.count_documents({"user_id": user_id}),
        db.installment_purchases.count_documents({"user_id": user_id}),
        db.receivables.count_documents({"user_id": user_id}),
        db.groups.count_documents({"creator_id": user_id}),
        db.shared_expenses.find(shared_query, {"_id": 0}).to_list(5000),
    )

    pending_settlements = 0
    for expense in shared_items:
        payer_id = expense.get("payer_id")
        has_pending_for_user = any(
            not participant.get("paid_back")
            and participant_reference(participant) != payer_id
            and user_id in (participant_reference(participant), payer_id)
            for participant in expense.get("participants", [])
        )
        if has_pending_for_user:
            pending_settlements += 1

    return {
        "income": income,
        "expenses": expenses,
        "transfers": transfers,
        "wallets": wallets,
        "balance_adjustments": balance_adjustments,
        "goals": goals,
        "shared_expenses": shared_expenses,
        "pending_settlements": pending_settlements,
        "recurrences": recurrences,
        "installment_purchases": installment_purchases,
        "receivables": receivables,
        "groups_created": groups_created,
    }


async def build_user_deletion_impact(
    candidate: dict,
    admin: dict,
) -> dict:
    blockers = []
    if candidate["id"] == admin["id"]:
        blockers.append("self_delete")
    if is_super_admin_user(candidate):
        blockers.append("super_admin_protected")
    if not can_manage_candidate(admin, candidate):
        blockers.append("admin_management_forbidden")

    if is_admin_user(candidate) and account_status(candidate) == "active":
        active_admins = await db.users.count_documents({
            "$and": [
                {
                    "$or": [
                        {"role": {"$in": ["ADMIN", "SUPER_ADMIN"]}},
                        {
                            "email": {
                                "$in": list(
                                    configured_admin_emails()
                                    | {configured_super_admin_email()}
                                ),
                            },
                        },
                    ],
                },
                {
                    "$or": [
                        {"status": "active"},
                        {"status": {"$exists": False}},
                    ],
                },
            ],
        })
        if active_admins <= 1:
            blockers.append("last_active_admin")

    impact = await user_financial_impact(candidate["id"])
    blockers.extend(
        key for key in FINANCIAL_DELETION_BLOCKERS if impact.get(key, 0) > 0
    )
    return {
        "user": admin_user_summary(candidate),
        "can_delete": not blockers,
        "blockers": blockers,
        "impact": impact,
        "sessions_will_be_terminated": True,
    }


@api.get("/admin/users", response_model=List[AdminUserOut])
async def list_admin_users(
    status: Literal["pending", "active", "inactive", "rejected", "all"] = "pending",
    admin=Depends(require_admin),
):
    if status == "active":
        query = {
            "$or": [
                {"status": "active"},
                {"status": {"$exists": False}},
            ],
        }
    elif status == "all":
        query = {}
    else:
        query = {"status": status}

    projection = {
        "_id": 0,
        "id": 1,
        "name": 1,
        "email": 1,
        "role": 1,
        "status": 1,
        "created_at": 1,
        "reviewed_at": 1,
    }
    users = await db.users.find(query, projection).sort("created_at", -1).to_list(500)
    return [admin_user_summary(candidate) for candidate in users]


@api.get("/admin/users/pending-count")
async def pending_admin_users_count(admin=Depends(require_admin)):
    return {"count": await db.users.count_documents({"status": "pending"})}


def can_manage_candidate(actor: dict, candidate: dict) -> bool:
    if is_super_admin_user(candidate):
        return False
    if is_super_admin_user(actor):
        return True
    return user_role(candidate) == "USER"


async def active_admin_count() -> int:
    return await db.users.count_documents({
        "$and": [
            {
                "$or": [
                    {"role": {"$in": ["ADMIN", "SUPER_ADMIN"]}},
                    {
                        "email": {
                            "$in": list(
                                configured_admin_emails()
                                | {configured_super_admin_email()}
                            ),
                        },
                    },
                ],
            },
            {
                "$or": [
                    {"status": "active"},
                    {"status": {"$exists": False}},
                ],
            },
            {"deletion_in_progress": {"$ne": True}},
        ],
    })


async def build_account_deletion_impact(user: dict) -> dict:
    impact = await user_financial_impact(user["id"])
    blockers = []
    if impact.get("pending_settlements", 0) > 0:
        blockers.append("pending_settlements")
    if is_admin_user(user):
        active_admins = await active_admin_count()
        minimum_remaining = 0 if user.get("deletion_in_progress") else 1
        if active_admins <= minimum_remaining:
            blockers.append("last_active_admin")
    return {
        "can_delete": not blockers,
        "blockers": blockers,
        "impact": impact,
        "shared_history_will_be_anonymized": True,
        "sessions_will_be_terminated": True,
    }


async def anonymize_user_in_shared_history(
    user_id: str,
    anonymous_user_id: str,
) -> None:
    shared_query = {
        "$or": [
            {"participant_ids": user_id},
            {"creator_id": user_id},
            {"payer_id": user_id},
        ],
    }
    shared_items = await db.shared_expenses.find(
        shared_query,
        {"_id": 0},
    ).to_list(5000)
    for expense in shared_items:
        participants = [
            {
                **participant,
                "user_id": (
                    anonymous_user_id
                    if participant.get("user_id") == user_id
                    else participant.get("user_id")
                ),
                "participant_id": (
                    anonymous_user_id
                    if participant_reference(participant) == user_id
                    else participant_reference(participant)
                ),
            }
            for participant in expense.get("participants", [])
        ]
        participant_ids = [
            anonymous_user_id if participant_id == user_id else participant_id
            for participant_id in expense.get("participant_ids", [])
        ]
        updates = {
            "participants": participants,
            "participant_ids": participant_ids,
            "anonymized_at": now_iso(),
        }
        if expense.get("creator_id") == user_id:
            updates["creator_id"] = anonymous_user_id
        if expense.get("payer_id") == user_id:
            updates["payer_id"] = anonymous_user_id
        await db.shared_expenses.update_one(
            {"id": expense["id"]},
            {"$set": updates},
        )

    await db.settlement_history.update_many(
        {"debtor_id": user_id},
        {"$set": {"debtor_id": anonymous_user_id}},
    )
    await db.settlement_history.update_many(
        {"creditor_id": user_id},
        {"$set": {"creditor_id": anonymous_user_id}},
    )


async def delete_user_owned_data(user_id: str) -> None:
    await db.people.delete_many({"owner_user_id": user_id})
    await db.categories.delete_many({"user_id": user_id})
    await db.accounts.delete_many({"user_id": user_id})
    await db.account_adjustments.delete_many({"user_id": user_id})
    await db.transactions.delete_many({"user_id": user_id})
    await db.goals.delete_many({"user_id": user_id})
    await db.goal_events.delete_many({"user_id": user_id})
    await db.recurrences.delete_many({"user_id": user_id})
    await db.installments.delete_many({"user_id": user_id})
    await db.installment_purchases.delete_many({"user_id": user_id})
    await db.receivables.delete_many({"user_id": user_id})
    await db.notifications.delete_many({"user_id": user_id})
    await db.insight_dismissals.delete_many({"user_id": user_id})
    await db.insight_feedback.delete_many({"user_id": user_id})
    await db.insight_history.delete_many({"user_id": user_id})
    await db.files.delete_many({"user_id": user_id})
    await db.websocket_tickets.delete_many({"user_id": user_id})
    await db.password_reset_tokens.delete_many({"user_id": user_id})
    await db.password_reset_requests.delete_many({"user_id": user_id})
    await db.email_delivery_logs.delete_many({"user_id": user_id})
    await db.groups.delete_many({"creator_id": user_id})
    await db.groups.update_many(
        {"member_ids": user_id},
        {"$pull": {"member_ids": user_id, "admin_ids": user_id}},
    )


@api.get(
    "/auth/account/deletion-impact",
    response_model=AccountDeletionImpactOut,
)
async def account_deletion_impact(user=Depends(get_current_user)):
    return await build_account_deletion_impact(user)


@api.delete("/auth/account")
async def delete_own_account(
    payload: AccountDeletionIn,
    user=Depends(get_current_user),
):
    candidate = await db.users.find_one({"id": user["id"]})
    if not candidate:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if not verify_password(payload.password, candidate.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    if payload.confirmation.strip().lower() != candidate["email"].strip().lower():
        raise HTTPException(
            status_code=400,
            detail="Digite o e-mail da conta exatamente como informado",
        )

    preview = await build_account_deletion_impact(candidate)
    if not preview["can_delete"]:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "A exclusão está bloqueada. Resolva os itens informados antes de continuar.",
                "blockers": preview["blockers"],
                "impact": preview["impact"],
            },
        )

    lock = await db.users.update_one(
        {
            "id": user["id"],
            "deletion_in_progress": {"$ne": True},
        },
        {"$set": {"deletion_in_progress": True}},
    )
    if not lock.matched_count:
        raise HTTPException(
            status_code=409,
            detail="A exclusão desta conta já está sendo processada",
        )

    try:
        locked_candidate = {**candidate, "deletion_in_progress": True}
        recheck = await build_account_deletion_impact(locked_candidate)
        if not recheck["can_delete"]:
            await db.users.update_one(
                {"id": user["id"]},
                {"$unset": {"deletion_in_progress": ""}},
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Novas pendências foram encontradas. Revise sua conta e tente novamente.",
                    "blockers": recheck["blockers"],
                    "impact": recheck["impact"],
                },
            )

        await ws_manager.disconnect_user(user["id"], code=4001)
        anonymous_user_id = f"deleted:{new_id()}"
        await anonymize_user_in_shared_history(user["id"], anonymous_user_id)
        await delete_user_owned_data(user["id"])
        deleted = await db.users.delete_one({
            "id": user["id"],
            "deletion_in_progress": True,
        })
        if not deleted.deleted_count:
            raise RuntimeError("User deletion lock was lost")
    except HTTPException:
        raise
    except Exception:
        await db.users.update_one(
            {"id": user["id"]},
            {"$unset": {"deletion_in_progress": ""}},
        )
        logger.exception("Self-service account deletion failed: user=%s", user["id"])
        raise HTTPException(
            status_code=500,
            detail="Não foi possível concluir a exclusão com segurança",
        )

    logger.info("Self-service account deletion completed: user=%s", user["id"])
    return {"ok": True}


@api.patch("/admin/users/{user_id}/role", response_model=AdminUserOut)
async def update_admin_user_role(
    user_id: str,
    payload: AdminRoleUpdateIn,
    super_admin=Depends(require_super_admin),
):
    candidate = await db.users.find_one({"id": user_id})
    if not candidate:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if is_super_admin_user(candidate):
        raise HTTPException(
            status_code=409,
            detail="O papel da super administradora é protegido",
        )
    if account_status(candidate) != "active":
        raise HTTPException(
            status_code=409,
            detail="Somente usuários ativos podem receber papel administrativo",
        )

    current_role = user_role(candidate)
    if current_role == payload.role:
        return admin_user_summary(candidate)
    if current_role == "ADMIN" and payload.role == "USER":
        if await active_admin_count() <= 1:
            raise HTTPException(
                status_code=409,
                detail="O sistema deve possuir ao menos um administrador ativo",
            )

    changed_at = now_iso()
    result = await db.users.update_one(
        {
            "id": user_id,
            "$or": [
                {"status": "active"},
                {"status": {"$exists": False}},
            ],
        },
        {
            "$set": {
                "role": payload.role,
                "role_updated_at": changed_at,
                "role_updated_by": super_admin["id"],
            },
        },
    )
    if not result.matched_count:
        raise HTTPException(
            status_code=409,
            detail="O usuário mudou de status. Atualize a lista e tente novamente",
        )
    candidate["role"] = payload.role
    return admin_user_summary(candidate)


@api.patch("/admin/users/{user_id}/status", response_model=AdminUserOut)
async def update_admin_user_status(
    user_id: str,
    payload: AdminStatusUpdateIn,
    admin=Depends(require_admin),
):
    candidate = await db.users.find_one({"id": user_id})
    if not candidate:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if candidate["id"] == admin["id"]:
        raise HTTPException(
            status_code=409,
            detail="Você não pode desativar a própria conta",
        )
    if not can_manage_candidate(admin, candidate):
        raise HTTPException(
            status_code=403,
            detail="Somente a super administradora pode gerenciar administradores",
        )

    current_status = account_status(candidate)
    if current_status == payload.status:
        return admin_user_summary(candidate)
    if current_status not in {"active", "inactive"}:
        raise HTTPException(
            status_code=409,
            detail="Use o fluxo de aprovação para cadastros pendentes ou rejeitados",
        )
    if (
        payload.status == "inactive"
        and is_admin_user(candidate)
        and await active_admin_count() <= 1
    ):
        raise HTTPException(
            status_code=409,
            detail="O sistema deve possuir ao menos um administrador ativo",
        )

    changed_at = now_iso()
    status_filter = (
        {
            "$or": [
                {"status": "active"},
                {"status": {"$exists": False}},
            ],
        }
        if current_status == "active"
        else {"status": current_status}
    )
    result = await db.users.update_one(
        {"id": user_id, **status_filter},
        {
            "$set": {
                "status": payload.status,
                "status_updated_at": changed_at,
                "status_updated_by": admin["id"],
            },
        },
    )
    if not result.matched_count:
        raise HTTPException(
            status_code=409,
            detail="O usuário mudou de status. Atualize a lista e tente novamente",
        )
    candidate["status"] = payload.status
    if payload.status == "inactive":
        await ws_manager.disconnect_user(user_id, code=4003)
    return admin_user_summary(candidate)


@api.patch("/admin/users/{user_id}", response_model=AdminUserOut)
async def update_admin_user_identity(
    user_id: str,
    payload: AdminIdentityUpdateIn,
    admin=Depends(require_admin),
):
    candidate = await db.users.find_one({"id": user_id})
    if not candidate:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if candidate["id"] == admin["id"] or not can_manage_candidate(admin, candidate):
        raise HTTPException(
            status_code=403,
            detail="Você não pode editar este usuário pelo painel administrativo",
        )
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome é obrigatório")
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "name": name,
                "identity_updated_at": now_iso(),
                "identity_updated_by": admin["id"],
            },
        },
    )
    candidate["name"] = name
    return admin_user_summary(candidate)


@api.get(
    "/admin/users/{user_id}/deletion-impact",
    response_model=AdminUserDeletionImpactOut,
)
async def admin_user_deletion_impact(
    user_id: str,
    admin=Depends(require_admin),
):
    candidate = await db.users.find_one({"id": user_id})
    if not candidate:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return await build_user_deletion_impact(candidate, admin)


@api.delete("/admin/users/{user_id}")
async def delete_admin_user(
    user_id: str,
    admin=Depends(require_admin),
):
    candidate = await db.users.find_one({"id": user_id})
    if not candidate:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    preview = await build_user_deletion_impact(candidate, admin)
    if not preview["can_delete"]:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "A exclusão está bloqueada. Resolva os itens informados antes de continuar.",
                "blockers": preview["blockers"],
                "impact": preview["impact"],
            },
        )

    lock = await db.users.update_one(
        {
            "id": user_id,
            "deletion_in_progress": {"$ne": True},
        },
        {"$set": {"deletion_in_progress": True}},
    )
    if not lock.matched_count:
        raise HTTPException(
            status_code=409,
            detail="A exclusão deste usuário já está sendo processada",
        )

    try:
        # Recheck after locking the account so a concurrent financial write
        # cannot silently bypass the deletion guard.
        impact = await user_financial_impact(user_id)
        financial_blockers = [
            key for key in FINANCIAL_DELETION_BLOCKERS if impact.get(key, 0) > 0
        ]
        if financial_blockers:
            await db.users.update_one(
                {"id": user_id},
                {"$unset": {"deletion_in_progress": ""}},
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Novas pendências foram encontradas. Revise o impacto e tente novamente.",
                    "blockers": financial_blockers,
                    "impact": impact,
                },
            )

        await ws_manager.disconnect_user(user_id, code=4001)

        # Only housekeeping and empty wallets remain here. Financial activity
        # and history are never cascade-deleted by this administrative action.
        await db.categories.delete_many({"user_id": user_id})
        await db.accounts.delete_many({"user_id": user_id})
        await db.account_adjustments.delete_many({"user_id": user_id})
        await db.notifications.delete_many({"user_id": user_id})
        await db.insight_dismissals.delete_many({"user_id": user_id})
        await db.insight_feedback.delete_many({"user_id": user_id})
        await db.insight_history.delete_many({"user_id": user_id})
        await db.files.delete_many({"user_id": user_id})
        await db.websocket_tickets.delete_many({"user_id": user_id})
        await db.password_reset_tokens.delete_many({"user_id": user_id})
        await db.password_reset_requests.delete_many({"user_id": user_id})
        await db.email_delivery_logs.delete_many({"user_id": user_id})
        await db.settlement_history.delete_many({
            "$or": [
                {"debtor_id": user_id},
                {"creditor_id": user_id},
            ],
        })
        await db.groups.update_many(
            {"member_ids": user_id},
            {"$pull": {"member_ids": user_id, "admin_ids": user_id}},
        )
        deleted = await db.users.delete_one({
            "id": user_id,
            "deletion_in_progress": True,
        })
        if not deleted.deleted_count:
            raise RuntimeError("User deletion lock was lost")
    except HTTPException:
        raise
    except Exception:
        await db.users.update_one(
            {"id": user_id},
            {"$unset": {"deletion_in_progress": ""}},
        )
        logger.exception(
            "Administrative user deletion failed: target=%s admin=%s",
            user_id,
            admin["id"],
        )
        raise HTTPException(
            status_code=500,
            detail="Não foi possível concluir a exclusão com segurança",
        )

    logger.info(
        "Administrative user deletion completed: target=%s admin=%s",
        user_id,
        admin["id"],
    )
    return {"ok": True, "deleted_user_id": user_id}


@api.post("/admin/users/{user_id}/approve", response_model=AdminUserOut)
async def approve_user(
    user_id: str,
    background_tasks: BackgroundTasks,
    admin=Depends(require_admin),
):
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if account_status(user) == "active":
        raise HTTPException(status_code=409, detail="Usuário já está ativo")

    lock = await db.users.update_one(
        {
            "id": user_id,
            "status": {"$in": ["pending", "rejected"]},
            "approval_in_progress": {"$ne": True},
        },
        {"$set": {"approval_in_progress": True}},
    )
    if not lock.matched_count:
        raise HTTPException(
            status_code=409,
            detail="Este cadastro já está sendo processado",
        )

    try:
        await seed_user_defaults(user["id"], user.get("currency", "EUR"))
    except Exception:
        await db.users.update_one(
            {"id": user_id},
            {"$unset": {"approval_in_progress": ""}},
        )
        raise

    reviewed_at = now_iso()
    activation = await db.users.update_one(
        {"id": user_id, "approval_in_progress": True},
        {
            "$set": {
                "status": "active",
                "reviewed_at": reviewed_at,
                "approved_by": admin["id"],
            },
            "$unset": {
                "rejected_by": "",
                "approval_in_progress": "",
            },
        },
    )
    if not activation.matched_count:
        raise HTTPException(
            status_code=409,
            detail="O status deste cadastro mudou durante a aprovação",
        )
    user.update({"status": "active", "reviewed_at": reviewed_at})
    background_tasks.add_task(email_service.send_welcome_email, user)
    return admin_user_summary(user)


@api.post("/admin/users/{user_id}/reject", response_model=AdminUserOut)
async def reject_user(user_id: str, admin=Depends(require_admin)):
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    status = account_status(user)
    if status == "active":
        raise HTTPException(
            status_code=409,
            detail="Usuário ativo não pode ser rejeitado por esta tela",
        )
    if status == "rejected":
        return admin_user_summary(user)

    reviewed_at = now_iso()
    result = await db.users.update_one(
        {
            "id": user_id,
            "status": "pending",
            "approval_in_progress": {"$ne": True},
        },
        {
            "$set": {
                "status": "rejected",
                "reviewed_at": reviewed_at,
                "rejected_by": admin["id"],
            },
            "$unset": {"approved_by": ""},
        },
    )
    if not result.matched_count:
        raise HTTPException(
            status_code=409,
            detail="Este cadastro já está sendo processado",
        )
    user.update({"status": "rejected", "reviewed_at": reviewed_at})
    return admin_user_summary(user)


# ---------- Categories ----------
@api.get("/categories")
async def list_categories(user=Depends(get_current_user)):
    return await db.categories.find(
        {"user_id": user["id"]},
        {"_id": 0, "name_key": 0},
    ).to_list(500)


@api.post("/categories")
async def create_category(
    payload: CategoryIn,
    user=Depends(get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    name = category_display_name(payload.name)
    if not name:
        raise HTTPException(400, "Nome é obrigatório")
    name_key = category_name_key(name)

    async def create():
        if await category_name_exists(user["id"], name_key):
            raise HTTPException(409, "Já existe uma categoria com esse nome")
        doc = {
            "id": new_id(),
            "user_id": user["id"],
            **payload.model_dump(),
            "name": name,
            "name_key": name_key,
            "is_default": False,
            "created_at": now_iso(),
        }
        try:
            await db.categories.insert_one(doc)
        except DuplicateKeyError:
            raise HTTPException(409, "Já existe uma categoria com esse nome")
        doc.pop("_id", None)
        doc.pop("name_key", None)
        return doc

    return await run_idempotent_create(
        "create_category", user["id"], idempotency_key,
        {**payload.model_dump(), "name": name}, create,
    )


@api.put("/categories/{cid}")
async def update_category(cid: str, payload: CategoryIn, user=Depends(get_current_user)):
    current = await db.categories.find_one(
        {"id": cid, "user_id": user["id"]},
        {"name": 1, "name_key": 1},
    )
    if not current:
        raise HTTPException(404, "Não encontrada")

    name = category_display_name(payload.name)
    if not name:
        raise HTTPException(400, "Nome é obrigatório")
    name_key = category_name_key(name)
    conflict = await category_name_exists(user["id"], name_key, cid)
    current_name_key = (
        current.get("name_key")
        or category_name_key(current.get("name"))
    )
    if conflict and current_name_key != name_key:
        raise HTTPException(409, "Já existe uma categoria com esse nome")

    updates = {**payload.model_dump(), "name": name}
    # Preserve editable legacy duplicates without deleting or merging user data.
    # Once a name is unique, persist its canonical key and let the index enforce
    # race-safe uniqueness from that point forward.
    if not conflict:
        updates["name_key"] = name_key
    try:
        await db.categories.update_one(
            {"id": cid, "user_id": user["id"]},
            {"$set": updates},
        )
    except DuplicateKeyError:
        raise HTTPException(409, "Já existe uma categoria com esse nome")
    return {"ok": True}


@api.delete("/categories/{cid}")
async def delete_category(cid: str, user=Depends(get_current_user)):
    await db.categories.delete_one({"id": cid, "user_id": user["id"]})
    return {"ok": True}


# ---------- Accounts ----------
@api.get("/exchange-rates/quote")
async def exchange_rate_quote(
    from_currency: str,
    to_currency: str,
    date: Optional[str] = None,
    user=Depends(get_current_user),
):
    source = normalize_currency(from_currency)
    target = normalize_currency(to_currency)
    if source == target:
        requested_date = date or datetime.now(timezone.utc).date().isoformat()
        return {
            "from": source, "to": target, "rate": 1.0,
            "date": requested_date,
            "requested_date": requested_date,
            "estimated": False,
            "source": "same_currency",
        }
    snapshot = await fetch_currency_snapshot(source, date)
    requested_date = date or datetime.now(timezone.utc).date().isoformat()
    return {
        "from": source, "to": target, "rate": snapshot["rates"][target],
        "date": snapshot["date"],
        "requested_date": snapshot.get("requested_date", requested_date),
        "estimated": snapshot.get("estimated", snapshot["date"] != requested_date),
        "source": snapshot["source"],
    }


async def account_currency_map(user: dict) -> dict:
    accounts = await db.accounts.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    base = normalize_currency(user.get("currency"))
    return {a["id"]: normalize_currency(a.get("currency"), base) for a in accounts}


def currency_for_account(
    requested_currency: Optional[str],
    account_id: Optional[str],
    currencies: dict,
    base_currency: str,
) -> str:
    account_currency = currencies.get(account_id) if account_id else None
    if account_id and not account_currency:
        raise HTTPException(404, "Carteira não encontrada")
    currency = normalize_currency(
        requested_currency, account_currency or base_currency
    )
    if account_currency and currency != account_currency:
        raise HTTPException(
            400,
            "A moeda do lançamento deve ser igual à moeda da carteira",
        )
    return currency


def account_balance_breakdown(
    account: dict,
    transactions: List[dict],
    installments: List[dict],
    adjustments: List[dict],
) -> dict:
    """Explain an account balance without classifying reconciliation as income."""
    currency = account.get("currency", "EUR")
    components = {
        "initial_balance": round(float(account.get("initial_balance") or 0), 2),
        "income": 0.0,
        "expense": 0.0,
        "transfers_in": 0.0,
        "transfers_out": 0.0,
        "installments": 0.0,
        "adjustments": 0.0,
    }
    entries = [{
        "id": f"initial:{account['id']}",
        "kind": "initial_balance",
        "date": account.get("created_at", "")[:10],
        "description": "Saldo inicial",
        "amount": components["initial_balance"],
        "currency": currency,
        "account_id": account["id"],
        "category_id": None,
        "status": "paid",
        "source": "account",
    }]

    for transaction in transactions:
        transaction_type = transaction.get("type")
        amount = round(float(transaction.get("amount") or 0), 2)
        entry_amount = 0.0
        kind = None
        if transaction_type == "income" and transaction.get("account_id") == account["id"]:
            components["income"] += amount
            entry_amount = amount
            kind = "income"
        elif transaction_type == "expense" and transaction.get("account_id") == account["id"]:
            components["expense"] += amount
            entry_amount = -amount
            kind = "expense"
        elif transaction_type == "transfer":
            if transaction.get("from_account_id") == account["id"]:
                components["transfers_out"] += amount
                entry_amount = -amount
                kind = "transfer_out"
            elif transaction.get("to_account_id") == account["id"]:
                received = round(
                    float(transaction.get("target_amount", amount) or 0),
                    2,
                )
                components["transfers_in"] += received
                entry_amount = received
                kind = "transfer_in"
        if kind:
            entries.append({
                "id": transaction.get("id"),
                "kind": kind,
                "date": transaction.get("date", ""),
                "description": (
                    transaction.get("description")
                    or "Lançamento sem descrição"
                ),
                "amount": entry_amount,
                "currency": currency,
                "account_id": account["id"],
                "category_id": transaction.get("category_id"),
                "status": transaction.get("status", "paid"),
                "source": "transaction",
            })

    for installment in installments:
        amount = round(float(installment.get("amount") or 0), 2)
        components["installments"] += amount
        entries.append({
            "id": installment.get("id"),
            "kind": "installment",
            "date": installment.get("due_date", ""),
            "description": installment.get("description") or "Parcela paga",
            "amount": -amount,
            "currency": currency,
            "account_id": account["id"],
            "category_id": installment.get("category_id"),
            "status": installment.get("status", "paid"),
            "source": "installment",
        })

    for adjustment in adjustments:
        amount = round(float(adjustment.get("amount") or 0), 2)
        components["adjustments"] += amount
        entries.append({
            "id": adjustment.get("id"),
            "kind": "adjustment",
            "date": adjustment.get("date", ""),
            "description": adjustment.get("note") or "Conciliação de saldo",
            "amount": amount,
            "previous_balance": adjustment.get("previous_balance"),
            "actual_balance": adjustment.get("actual_balance"),
            "currency": currency,
            "account_id": account["id"],
            "category_id": None,
            "status": "paid",
            "source": "reconciliation",
        })

    components = {
        key: round(value, 2)
        for key, value in components.items()
    }
    current_balance = round(
        components["initial_balance"]
        + components["income"]
        - components["expense"]
        + components["transfers_in"]
        - components["transfers_out"]
        - components["installments"]
        + components["adjustments"],
        2,
    )
    entries.sort(
        key=lambda item: (
            item.get("date", ""),
            item["kind"] != "initial_balance",
        ),
        reverse=True,
    )
    return {
        "account_id": account["id"],
        "account_name": account.get("name", "Carteira"),
        "currency": currency,
        "components": components,
        "entries": entries,
        "current_balance": current_balance,
    }


async def load_account_balance_breakdowns(
    accounts: List[dict],
    user: dict,
) -> List[dict]:
    if not accounts:
        return []
    account_ids = [account["id"] for account in accounts]
    account_id_set = set(account_ids)
    transactions, paid_installments, adjustments = await asyncio.gather(
        db.transactions.find({
            "user_id": user["id"],
            "status": "paid",
            "$or": [
                {"account_id": {"$in": account_ids}},
                {"from_account_id": {"$in": account_ids}},
                {"to_account_id": {"$in": account_ids}},
            ],
        }, {"_id": 0}).to_list(20000),
        db.installments.find({
            "user_id": user["id"],
            "status": "paid",
        }, {"_id": 0}).to_list(5000),
        db.account_adjustments.find({
            "user_id": user["id"],
            "account_id": {"$in": account_ids},
            "deleted_at": {"$exists": False},
        }, {"_id": 0}).to_list(5000),
    )

    installments_by_account = defaultdict(list)
    if paid_installments:
        purchase_ids = list({
            item["purchase_id"]
            for item in paid_installments
            if item.get("purchase_id")
        })
        purchases = await db.installment_purchases.find({
            "id": {"$in": purchase_ids},
            "user_id": user["id"],
            "account_id": {"$in": account_ids},
        }, {"_id": 0}).to_list(500)
        purchases_by_id = {item["id"]: item for item in purchases}
        for installment in paid_installments:
            purchase = purchases_by_id.get(installment.get("purchase_id"))
            if not purchase:
                continue
            installments_by_account[purchase["account_id"]].append({
                **installment,
                "category_id": purchase.get("category_id"),
                "description": (
                    f"{purchase.get('description', 'Parcela')} "
                    f"({installment.get('number', '?')}/{installment.get('total', '?')})"
                ),
            })

    transactions_by_account = defaultdict(list)
    seen_transactions = defaultdict(set)
    for index, transaction in enumerate(transactions):
        transaction_token = transaction.get("id") or f"row:{index}"
        for account_field in ("account_id", "from_account_id", "to_account_id"):
            account_id = transaction.get(account_field)
            if (
                account_id in account_id_set
                and transaction_token not in seen_transactions[account_id]
            ):
                transactions_by_account[account_id].append(transaction)
                seen_transactions[account_id].add(transaction_token)
    adjustments_by_account = defaultdict(list)
    for adjustment in adjustments:
        adjustments_by_account[adjustment.get("account_id")].append(adjustment)

    return [
        account_balance_breakdown(
            account,
            transactions_by_account[account["id"]],
            installments_by_account[account["id"]],
            adjustments_by_account[account["id"]],
        )
        for account in accounts
    ]


async def load_account_balance_breakdown(account: dict, user: dict) -> dict:
    return (await load_account_balance_breakdowns([account], user))[0]


@api.get("/accounts")
async def list_accounts(
    currency: Optional[str] = None,
    user=Depends(get_current_user),
):
    accounts = await db.accounts.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)
    base_currency = normalize_currency(user.get("currency"))
    for a in accounts:
        a["currency"] = normalize_currency(a.get("currency"), base_currency)
    if currency:
        selected_currency = normalize_currency(currency)
        accounts = [a for a in accounts if a["currency"] == selected_currency]
    breakdowns = await load_account_balance_breakdowns(accounts, user)
    breakdown_by_account = {
        item["account_id"]: item
        for item in breakdowns
    }
    for a in accounts:
        a["balance"] = breakdown_by_account[a["id"]]["current_balance"]
        if a["currency"] == base_currency:
            a["balance_base"] = a["balance"]
        else:
            try:
                snapshot = await fetch_currency_snapshot(a["currency"])
                rate = snapshot["rates"][base_currency]
                a["balance_base"] = round(a["balance"] * rate, 2)
                a["balance_base_rate"] = rate
                a["balance_base_rate_date"] = snapshot["date"]
            except HTTPException:
                a["balance_base"] = round(amount_in_currency(a, base_currency, "balance"), 2)
                a["balance_base_unavailable"] = True
        a["base_currency"] = base_currency
    return accounts


@api.get("/accounts/{aid}/balance-breakdown")
async def get_account_balance_breakdown(
    aid: str,
    user=Depends(get_current_user),
):
    account = await db.accounts.find_one(
        {"id": aid, "user_id": user["id"]},
        {"_id": 0},
    )
    if not account:
        raise HTTPException(404, "Carteira não encontrada")
    account["currency"] = normalize_currency(
        account.get("currency"),
        user.get("currency", "EUR"),
    )
    return await load_account_balance_breakdown(account, user)


@api.post("/accounts/{aid}/reconcile")
async def reconcile_account_balance(
    aid: str,
    payload: AccountReconciliationIn,
    user=Depends(get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    async def reconcile():
        account = await db.accounts.find_one(
            {"id": aid, "user_id": user["id"]},
            {"_id": 0},
        )
        if not account:
            raise HTTPException(404, "Carteira não encontrada")
        if not all(math.isfinite(value) for value in (
            payload.actual_balance,
            payload.expected_balance,
        )):
            raise HTTPException(400, "Informe um saldo válido")
        account["currency"] = normalize_currency(
            account.get("currency"),
            user.get("currency", "EUR"),
        )
        breakdown = await load_account_balance_breakdown(account, user)
        current_balance = breakdown["current_balance"]
        if abs(current_balance - payload.expected_balance) >= 0.01:
            raise HTTPException(
                409,
                "O saldo mudou enquanto a conciliação estava aberta. Revise o cálculo e tente novamente.",
            )
        difference = round(payload.actual_balance - current_balance, 2)
        if abs(difference) < 0.01:
            return {
                "ok": True,
                "adjusted": False,
                "difference": 0.0,
                "current_balance": current_balance,
                "currency": account["currency"],
            }
        adjustment = {
            "id": new_id(),
            "user_id": user["id"],
            "account_id": aid,
            "date": now_iso()[:10],
            "amount": difference,
            "currency": account["currency"],
            "previous_balance": current_balance,
            "actual_balance": round(payload.actual_balance, 2),
            "note": " ".join(payload.note.split()),
            "created_at": now_iso(),
        }
        await db.account_adjustments.insert_one(adjustment)
        return {
            "ok": True,
            "adjusted": True,
            "adjustment_id": adjustment["id"],
            "difference": difference,
            "previous_balance": current_balance,
            "current_balance": adjustment["actual_balance"],
            "currency": account["currency"],
        }

    return await run_idempotent_create(
        "reconcile_account",
        user["id"],
        idempotency_key,
        {"account_id": aid, **payload.model_dump()},
        reconcile,
    )


@api.put("/accounts/{aid}/reconciliations/{rid}")
async def update_account_reconciliation(
    aid: str,
    rid: str,
    payload: AccountReconciliationUpdateIn,
    user=Depends(get_current_user),
):
    adjustment = await db.account_adjustments.find_one(
        {
            "id": rid,
            "account_id": aid,
            "user_id": user["id"],
            "deleted_at": {"$exists": False},
        },
        {"_id": 0},
    )
    if not adjustment:
        raise HTTPException(404, "Conciliação não encontrada")
    if not math.isfinite(payload.actual_balance):
        raise HTTPException(400, "Informe um saldo válido")

    previous_balance = float(adjustment.get("previous_balance") or 0)
    actual_balance = round(payload.actual_balance, 2)
    amount = round(actual_balance - previous_balance, 2)
    note = " ".join(payload.note.split())
    changed_at = now_iso()
    previous_version = {
        "amount": round(float(adjustment.get("amount") or 0), 2),
        "actual_balance": round(float(adjustment.get("actual_balance") or 0), 2),
        "note": adjustment.get("note", ""),
        "changed_at": changed_at,
    }
    await db.account_adjustments.update_one(
        {
            "id": rid,
            "account_id": aid,
            "user_id": user["id"],
            "deleted_at": {"$exists": False},
        },
        {
            "$set": {
                "amount": amount,
                "actual_balance": actual_balance,
                "note": note,
                "updated_at": changed_at,
            },
            "$push": {"edit_history": previous_version},
        },
    )
    return {
        "ok": True,
        "adjustment_id": rid,
        "difference": amount,
        "actual_balance": actual_balance,
        "currency": adjustment.get("currency", "EUR"),
    }


@api.delete("/accounts/{aid}/reconciliations/{rid}")
async def delete_account_reconciliation(
    aid: str,
    rid: str,
    user=Depends(get_current_user),
):
    adjustment = await db.account_adjustments.find_one(
        {
            "id": rid,
            "account_id": aid,
            "user_id": user["id"],
            "deleted_at": {"$exists": False},
        },
        {"_id": 0},
    )
    if not adjustment:
        raise HTTPException(404, "Conciliação não encontrada")
    await db.account_adjustments.update_one(
        {
            "id": rid,
            "account_id": aid,
            "user_id": user["id"],
            "deleted_at": {"$exists": False},
        },
        {"$set": {"deleted_at": now_iso()}},
    )
    return {"ok": True}


@api.post("/accounts")
async def create_account(
    payload: AccountIn,
    user=Depends(get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    async def create():
        currency = normalize_currency(payload.currency, user.get("currency", "EUR"))
        meta = await monetary_metadata(currency, user.get("currency", "EUR"))
        values = payload.model_dump(exclude={"currency"})
        doc = {"id": new_id(), "user_id": user["id"], **values, **meta,
               "created_at": now_iso()}
        await db.accounts.insert_one(doc)
        doc.pop("_id", None)
        return doc

    return await run_idempotent_create(
        "create_account", user["id"], idempotency_key,
        payload.model_dump(), create,
    )


@api.put("/accounts/{aid}")
async def update_account(aid: str, payload: AccountIn, user=Depends(get_current_user)):
    current = await db.accounts.find_one({"id": aid, "user_id": user["id"]}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Carteira não encontrada")
    current_currency = normalize_currency(current.get("currency"), user.get("currency", "EUR"))
    new_currency = normalize_currency(payload.currency, current_currency)
    if round(payload.initial_balance, 2) != round(
        float(current.get("initial_balance") or 0),
        2,
    ):
        raise HTTPException(
            400,
            "O saldo inicial não pode ser alterado depois da criação. Use a conciliação de saldo.",
        )
    if new_currency != current_currency:
        has_activity = await db.transactions.count_documents({
            "user_id": user["id"],
            "$or": [{"account_id": aid}, {"from_account_id": aid}, {"to_account_id": aid}],
        })
        if has_activity:
            raise HTTPException(
                400,
                "Não é possível alterar a moeda de uma carteira com lançamentos. Crie uma nova carteira.",
            )
    meta = await monetary_metadata(new_currency, user.get("currency", "EUR"))
    values = payload.model_dump(exclude={"currency"})
    res = await db.accounts.update_one(
        {"id": aid, "user_id": user["id"]}, {"$set": {**values, **meta}})
    if not res.matched_count:
        raise HTTPException(404, "Carteira não encontrada")
    return {"ok": True}


@api.delete("/accounts/{aid}")
async def delete_account(aid: str, user=Depends(get_current_user)):
    await db.accounts.delete_one({"id": aid, "user_id": user["id"]})
    return {"ok": True}


# ---------- Transactions ----------
@api.get("/transactions")
async def list_transactions(
    user=Depends(get_current_user),
    year: Optional[int] = None, month: Optional[int] = None,
    category_id: Optional[str] = None, status: Optional[str] = None,
    type: Optional[str] = None, account_id: Optional[str] = None,
    currency: Optional[str] = None,
    include_carryover: bool = True,
):
    horizon = month_end_date(year, month) if (year and month) else None
    await materialize_recurrences(user["id"], horizon)
    base_currency = normalize_currency(user.get("currency"))

    q = {"user_id": user["id"]}
    start = end = None
    if year and month:
        s, e = month_range(year, month)
        start, end = s[:10], e[:10]
        q["date"] = {"$gte": start, "$lt": end}
    if category_id:
        q["category_id"] = category_id
    if status:
        q["status"] = status
    if type:
        q["type"] = type
    clauses = []
    if account_id:
        clauses.append({"$or": [
            {"account_id": account_id},
            {"from_account_id": account_id},
            {"to_account_id": account_id},
        ]})
    selected_currency = normalize_currency(currency) if currency else None
    if clauses:
        q["$and"] = clauses
    rows = await db.transactions.find(q, {"_id": 0}).to_list(2000)
    for r in rows:
        if r.get("shared_expense_id"):
            r["source"] = "shared_expense"
            r["editable"] = False
        else:
            r["source"] = "recurrence" if r.get("recurrence_id") else "manual"
            r["editable"] = True
        r["overdue"] = False

    # Roll-over: include real transactions still pending from previous months
    # (so the user sees them in the current view and can confirm payment)
    if year and month and status in (None, "pending") and include_carryover:
        overdue_q = {
            "user_id": user["id"],
            "status": "pending",
            "date": {"$lt": start},
        }
        if category_id:
            overdue_q["category_id"] = category_id
        if type:
            overdue_q["type"] = type
        overdue_clauses = []
        if account_id:
            overdue_clauses.append({"$or": [
                {"account_id": account_id},
                {"from_account_id": account_id},
                {"to_account_id": account_id},
            ]})
        if overdue_clauses:
            overdue_q["$and"] = overdue_clauses
        overdue_rows = await db.transactions.find(overdue_q, {"_id": 0}).to_list(2000)
        existing_ids = {r["id"] for r in rows}
        for r in overdue_rows:
            if r["id"] in existing_ids:
                continue
            if r.get("shared_expense_id"):
                r["source"] = "shared_expense"
                r["editable"] = False
            else:
                r["source"] = "recurrence" if r.get("recurrence_id") else "manual"
                r["editable"] = True
            r["overdue"] = True
            rows.append(r)

    # Merge installment parcels as linked entries — only this month's + overdue pending
    # (avoids cluttering the list with far-future parcels)
    if type in (None, "expense"):
        now = datetime.now(timezone.utc)
        vy, vm = (year, month) if (year and month) else (now.year, now.month)
        vs, ve = month_range(vy, vm)
        vstart, vend = vs[:10], ve[:10]
        iq = {"user_id": user["id"], "$or": [
            {"due_date": {"$gte": vstart, "$lt": vend}},
            {"due_date": {"$lt": vstart}, "status": "pending"},
        ]}
        if not include_carryover:
            iq = {"user_id": user["id"], "due_date": {"$gte": vstart, "$lt": vend}}
        parcels = await db.installments.find(iq, {"_id": 0}).to_list(2000)
        if status:
            parcels = [p for p in parcels if p["status"] == status]
        if parcels:
            pids = list({p["purchase_id"] for p in parcels})
            purchases = await db.installment_purchases.find(
                {"id": {"$in": pids}}, {"_id": 0}).to_list(500)
            pmap = {p["id"]: p for p in purchases}
            for p in parcels:
                pur = pmap.get(p["purchase_id"], {})
                if category_id and pur.get("category_id") != category_id:
                    continue
                if account_id and pur.get("account_id") != account_id:
                    continue
                purchase_currency = normalize_currency(
                    pur.get("currency"), base_currency
                )
                if currency and purchase_currency != selected_currency:
                    continue
                overdue = p["due_date"] < vstart and p["status"] == "pending"
                rows.append({
                    "id": p["id"], "type": "expense", "date": p["due_date"],
                    "amount": p["amount"], "category_id": pur.get("category_id"),
                    "account_id": pur.get("account_id"),
                    "payment_method": pur.get("payment_method"),
                    "description": f"{pur.get('description', 'Parcela')} ({p['number']}/{p['total']})",
                    "notes": "atrasada" if overdue else "", "status": p["status"],
                    "source": "installment", "purchase_id": p["purchase_id"],
                    "installment_number": p["number"], "installment_total": p["total"],
                    "overdue": overdue, "editable": False,
                    "currency": purchase_currency,
                    "exchange_rates": pur.get("exchange_rates"),
                    "base_currency_at_creation": pur.get("base_currency_at_creation"),
                    "exchange_rate_to_base": pur.get("exchange_rate_to_base"),
                })

    person_ids = {row.get("person_id") for row in rows if row.get("person_id")}
    person_map = {}
    if person_ids:
        private_people, registered_people = await asyncio.gather(
            db.people.find({
                "id": {"$in": list(person_ids)},
                "owner_user_id": user["id"],
            }, {"_id": 0}).to_list(1000),
            db.users.find({
                "id": {"$in": list(person_ids)},
            }, {"_id": 0, "password_hash": 0}).to_list(1000),
        )
        person_map.update({
            item["id"]: private_person_summary(item)
            for item in private_people
        })
        person_map.update({
            item["id"]: public_user(item)
            for item in registered_people
        })

    currencies = await account_currency_map(user)
    for row in rows:
        row["person"] = person_map.get(row.get("person_id"))
        if row.get("type") == "transfer":
            row["currency"] = normalize_currency(
                row.get("currency"), currencies.get(row.get("from_account_id"), base_currency))
            row["target_currency"] = normalize_currency(
                row.get("target_currency"), currencies.get(row.get("to_account_id"), base_currency))
            row["target_amount"] = row.get("target_amount", row.get("amount", 0))
        else:
            row["currency"] = normalize_currency(
                row.get("currency"), currencies.get(row.get("account_id"), base_currency))
            row["base_amount"] = round(amount_in_currency(row, base_currency), 2)
    if selected_currency:
        rows = [
            row for row in rows
            if row.get("currency") == selected_currency
            or row.get("target_currency") == selected_currency
        ]
    rows.sort(key=lambda x: x.get("date", ""), reverse=True)
    return rows


async def transaction_values(payload: TransactionIn, user: dict) -> dict:
    if payload.amount <= 0:
        raise HTTPException(400, "O valor deve ser maior que zero")
    currencies = await account_currency_map(user)
    base_currency = normalize_currency(user.get("currency"))
    excluded = {"currency", "exchange_rate", "target_amount", "rate_source"}
    values = payload.model_dump(exclude=excluded)
    if payload.type == "transfer":
        source_currency = currencies[payload.from_account_id]
        target_currency = currencies[payload.to_account_id]
        rate = payload.exchange_rate if payload.rate_source != "automatic" else None
        source_label = payload.rate_source
        if source_currency == target_currency:
            rate = 1.0
            source_label = "automatic"
        elif rate is None:
            snapshot = await fetch_currency_snapshot(source_currency, payload.date)
            rate = snapshot["rates"][target_currency]
            source_label = "automatic"
        if rate <= 0:
            raise HTTPException(400, "A cotação deve ser maior que zero")
        target_amount = payload.target_amount if payload.target_amount is not None else payload.amount * rate
        if target_amount <= 0:
            raise HTTPException(400, "O valor recebido deve ser maior que zero")
        return {
            **values,
            "currency": source_currency,
            "target_currency": target_currency,
            "target_amount": round(target_amount, 2),
            "transfer_exchange_rate": float(rate),
            "rate_source": source_label or "manual",
        }

    currency = currency_for_account(
        payload.currency, payload.account_id, currencies, base_currency
    )
    manual_rate = payload.exchange_rate if payload.rate_source != "automatic" else None
    meta = await monetary_metadata(currency, base_currency, payload.date, manual_rate)
    if payload.rate_source:
        meta["rate_source"] = payload.rate_source
    return {
        **values,
        **meta,
        "base_amount": round(payload.amount * meta["exchange_rate_to_base"], 2),
    }


async def validate_transaction_person(person_id: Optional[str], user: dict) -> Optional[dict]:
    """Resolve a counterparty without trusting a client-provided reference."""
    if not person_id:
        return None
    if person_id == user["id"]:
        raise HTTPException(400, "Selecione outra pessoa")

    person = await db.people.find_one(
        {"id": person_id, "owner_user_id": user["id"]},
        {"_id": 0},
    )
    if person:
        return private_person_summary(person)

    related_expense = await db.shared_expenses.find_one({
        "$and": [
            visible_shared_query(user["id"]),
            {
                "$or": [
                    {"payer_id": person_id},
                    {"participants.user_id": person_id},
                ],
            },
        ],
    }, {"_id": 0})
    related_user = (
        await db.users.find_one(
            {"id": person_id},
            {"_id": 0, "password_hash": 0},
        )
        if related_expense else None
    )
    if not related_user:
        raise HTTPException(404, "Pessoa não encontrada")
    return public_user(related_user)


async def notify_pending_receivable_counterparty(
    transaction: dict,
    user: dict,
) -> None:
    """Notify a registered private contact without disclosing account existence."""
    if (
        transaction.get("type") != "income"
        or transaction.get("status") != "pending"
        or not transaction.get("person_id")
    ):
        return
    person = await db.people.find_one(
        {
            "id": transaction["person_id"],
            "owner_user_id": user["id"],
        },
        {"_id": 0},
    )
    email = str((person or {}).get("email") or "").strip().lower()
    if not email:
        return
    recipient = await db.users.find_one(
        {
            "email": email,
            "id": {"$ne": user["id"]},
            "$or": [
                {"status": "active"},
                {"status": {"$exists": False}},
            ],
        },
        {"_id": 0, "password_hash": 0},
    )
    if not recipient:
        return
    if transaction.get("counterparty_notified_user_id") == recipient["id"]:
        return

    currency = normalize_currency(
        transaction.get("currency"), user.get("currency", "EUR")
    )
    description = (transaction.get("description") or "").strip()
    suffix = f": {description}" if description else "."
    await push_notification(
        recipient["id"],
        "pending_receivable_added",
        "Novo valor pendente",
        (
            f"{user['name']} registrou {fmt_eur(transaction.get('amount', 0), currency)} "
            f"pendentes a receber de você{suffix}"
        ),
        "/notificacoes",
        {
            "transaction_id": transaction["id"],
            "creditor_user_id": user["id"],
            "amount": transaction.get("amount", 0),
            "currency": currency,
        },
    )
    notified_at = now_iso()
    await db.transactions.update_one(
        {"id": transaction["id"], "user_id": user["id"]},
        {"$set": {
            "counterparty_notified_user_id": recipient["id"],
            "counterparty_notified_at": notified_at,
        }},
    )
    transaction["counterparty_notified_user_id"] = recipient["id"]
    transaction["counterparty_notified_at"] = notified_at


@api.post("/transactions")
async def create_transaction(
    payload: TransactionIn,
    user=Depends(get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    async def create():
        await _validate_transfer(payload, user)
        await validate_transaction_person(payload.person_id, user)
        values = await transaction_values(payload, user)
        doc = {"id": new_id(), "user_id": user["id"], **values,
               "created_at": now_iso()}
        await db.transactions.insert_one(doc)
        doc.pop("_id", None)
        try:
            await notify_pending_receivable_counterparty(doc, user)
        except Exception as exc:
            logger.warning(
                "Pending-receivable notification failed for transaction %s: %s",
                doc["id"],
                exc,
            )
        return doc

    return await run_idempotent_create(
        "create_transaction", user["id"], idempotency_key,
        payload.model_dump(), create,
    )


async def _validate_transfer(payload: TransactionIn, user):
    if payload.type != "transfer":
        return
    if payload.person_id:
        raise HTTPException(400, "Transferências entre carteiras não possuem pessoa vinculada")
    if not payload.from_account_id or not payload.to_account_id:
        raise HTTPException(400, "Selecione as contas de origem e destino")
    if payload.from_account_id == payload.to_account_id:
        raise HTTPException(400, "Origem e destino devem ser contas diferentes")
    count = await db.accounts.count_documents(
        {"user_id": user["id"], "id": {"$in": [payload.from_account_id, payload.to_account_id]}})
    if count < 2:
        raise HTTPException(404, "Conta não encontrada")


@api.put("/transactions/{tid}")
async def update_transaction(tid: str, payload: TransactionIn, user=Depends(get_current_user)):
    await _validate_transfer(payload, user)
    await validate_transaction_person(payload.person_id, user)
    values = await transaction_values(payload, user)
    current = await db.transactions.find_one(
        {"id": tid, "user_id": user["id"]}, {"_id": 0}
    )
    if not current:
        raise HTTPException(404, "Não encontrado")
    if current.get("shared_expense_id"):
        raise HTTPException(
            409,
            "Edite este lançamento pela despesa compartilhada vinculada",
        )
    res = await db.transactions.update_one(
        {"id": tid, "user_id": user["id"]},
        {"$set": values},
    )
    updated = {**current, **values}
    try:
        await notify_pending_receivable_counterparty(updated, user)
    except Exception as exc:
        logger.warning(
            "Pending-receivable notification failed for transaction %s: %s",
            tid,
            exc,
        )
    return {"ok": True}


@api.delete("/transactions/{tid}")
async def delete_transaction(tid: str, user=Depends(get_current_user)):
    tx = await db.transactions.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
    if tx and tx.get("shared_expense_id"):
        raise HTTPException(
            409,
            "Exclua este lançamento pela despesa compartilhada vinculada",
        )
    if tx and tx.get("receipt"):
        await db.files.update_one({"id": tx["receipt"]["file_id"]}, {"$set": {"is_deleted": True}})
    await db.transactions.delete_one({"id": tid, "user_id": user["id"]})
    return {"ok": True}


@api.post("/transactions/{tid}/pay")
async def toggle_transaction_payment(tid: str, user=Depends(get_current_user)):
    """Toggle a real transaction between paid <-> pending.

    Used by the "Confirmar pagamento" button in the Lançamentos list.
    Recorded paid transactions affect the wallet balance immediately;
    pending ones don't (rolling over to next months until confirmed).
    """
    tx = await db.transactions.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Lançamento não encontrado")
    if tx.get("shared_expense_id"):
        raise HTTPException(
            409,
            "O pagamento é controlado pela despesa compartilhada vinculada",
        )
    if tx.get("status") == "cancelled":
        raise HTTPException(400, "Lançamento cancelado não pode ser pago")
    new_status = "pending" if tx.get("status") == "paid" else "paid"
    await db.transactions.update_one(
        {"id": tid, "user_id": user["id"]},
        {"$set": {"status": new_status}},
    )
    return {"ok": True, "status": new_status}


class BulkDeleteIn(BaseModel):
    ids: List[str]


@api.post("/transactions/bulk-delete")
async def bulk_delete_transactions(body: BulkDeleteIn, user=Depends(get_current_user)):
    if not body.ids:
        return {"deleted": 0}
    txs = await db.transactions.find(
        {"id": {"$in": body.ids}, "user_id": user["id"]}, {"_id": 0}).to_list(5000)
    protected_ids = {
        tx["id"] for tx in txs if tx.get("shared_expense_id")
    }
    for tx in txs:
        if tx["id"] in protected_ids:
            continue
        if tx.get("receipt"):
            await db.files.update_one(
                {"id": tx["receipt"]["file_id"]}, {"$set": {"is_deleted": True}})
    res = await db.transactions.delete_many(
        {
            "id": {"$in": [
                transaction_id
                for transaction_id in body.ids
                if transaction_id not in protected_ids
            ]},
            "user_id": user["id"],
        })
    return {"deleted": res.deleted_count}


# ---------- Receipts (attachments) ----------
@api.post("/transactions/{tid}/receipt")
async def upload_receipt(tid: str, file: UploadFile = File(...), user=Depends(get_current_user)):
    tx = await db.transactions.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Lançamento não encontrado")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    if ext not in MIME_TYPES:
        raise HTTPException(400, "Formato não suportado (use JPG, PNG, WEBP, GIF ou PDF)")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "Arquivo muito grande (máx 5MB)")
    content_type = file.content_type or MIME_TYPES[ext]
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    result = await asyncio.to_thread(_put_object, path, data, content_type)
    fid = new_id()
    await db.files.insert_one({
        "id": fid, "user_id": user["id"], "storage_path": result["path"],
        "original_filename": file.filename, "content_type": content_type,
        "size": result.get("size", len(data)), "is_deleted": False,
        "created_at": now_iso(),
    })
    receipt = {"file_id": fid, "path": result["path"],
               "filename": file.filename, "content_type": content_type}
    await db.transactions.update_one({"id": tid}, {"$set": {"receipt": receipt}})
    return receipt


@api.delete("/transactions/{tid}/receipt")
async def delete_receipt(tid: str, user=Depends(get_current_user)):
    tx = await db.transactions.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
    if not tx or not tx.get("receipt"):
        raise HTTPException(404, "Sem comprovante")
    await db.files.update_one({"id": tx["receipt"]["file_id"]}, {"$set": {"is_deleted": True}})
    await db.transactions.update_one({"id": tid}, {"$unset": {"receipt": ""}})
    return {"ok": True}


async def _user_from_token(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user or account_status(user) != "active":
        return None
    return user


@api.get("/files/{path:path}")
async def download_file(path: str, authorization: str = Header(None), auth: str = Query(None)):
    token = authorization[7:] if (authorization or "").startswith("Bearer ") else auth
    if not token or not await _user_from_token(token):
        raise HTTPException(401, "Não autenticado")
    record = await db.files.find_one({"storage_path": path, "is_deleted": False}, {"_id": 0})
    if not record:
        raise HTTPException(404, "Arquivo não encontrado")
    data, ct = await asyncio.to_thread(_get_object, path)
    return Response(content=data, media_type=record.get("content_type", ct))


# ---------- Recurrences ----------
def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _advance(d: date, freq: str) -> date:
    if freq == "weekly":
        return d + timedelta(days=7)
    if freq == "yearly":
        return _add_months(d, 12)
    if freq == "semiannual":
        return _add_months(d, 6)
    if freq == "quarterly":
        return _add_months(d, 3)
    return _add_months(d, 1)


async def materialize_recurrences(user_id: str, horizon: Optional[date] = None):
    today = datetime.now(timezone.utc).date()
    if horizon is None:
        last_day = calendar.monthrange(today.year, today.month)[1]
        horizon = date(today.year, today.month, last_day)
    # Cap projection to avoid creating dozens of future transactions when
    # navigating far-ahead months (bounds data growth).
    max_horizon = _add_months(date(today.year, today.month, 1), 12)
    if horizon > max_horizon:
        horizon = max_horizon
    recs = await db.recurrences.find({"user_id": user_id, "active": True}, {"_id": 0}).to_list(500)
    for r in recs:
        try:
            nxt = datetime.strptime(r["next_run"], "%Y-%m-%d").date()
        except Exception:
            continue
        changed = False
        guard = 0
        while nxt <= horizon and guard < 120:
            guard += 1
            # Idempotent: never create a second transaction for the same
            # (recurrence, date). Prevents duplicates when next_run is edited
            # back to an already-materialized date.
            exists = await db.transactions.find_one(
                {"user_id": user_id, "recurrence_id": r["id"], "date": nxt.isoformat()},
                {"_id": 1},
            )
            if not exists:
                await db.transactions.insert_one({
                    "id": new_id(), "user_id": user_id, "type": r["type"],
                    "date": nxt.isoformat(), "amount": r["amount"],
                    "category_id": r.get("category_id"), "person_id": r.get("person_id"),
                    "account_id": r.get("account_id"),
                    "from_account_id": None, "to_account_id": None,
                    "payment_method": r.get("payment_method"),
                    "description": r.get("description", ""), "notes": "(recorrente)",
                    "status": "paid" if nxt <= today else "pending",
                    "recurrence_id": r["id"], "created_at": now_iso(),
                    "currency": r.get("currency"),
                    "exchange_rates": r.get("exchange_rates"),
                    "base_currency_at_creation": r.get("base_currency_at_creation"),
                    "exchange_rate_to_base": r.get("exchange_rate_to_base"),
                    "rate_date": r.get("rate_date"),
                    "rate_source": r.get("rate_source"),
                })
            nxt = _advance(nxt, r["frequency"])
            changed = True
        if changed:
            await db.recurrences.update_one({"id": r["id"]}, {"$set": {"next_run": nxt.isoformat()}})


class RecurrenceIn(BaseModel):
    type: Literal["income", "expense"] = "expense"
    amount: float
    category_id: Optional[str] = None
    person_id: Optional[str] = None
    account_id: Optional[str] = None
    payment_method: Optional[str] = None
    description: str = ""
    frequency: Literal["weekly", "monthly", "quarterly", "semiannual", "yearly"] = "monthly"
    next_run: str
    active: bool = True
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None
    rate_source: Optional[Literal["automatic", "manual"]] = None


@api.get("/recurrences")
async def list_recurrences(
    currency: Optional[str] = None,
    user=Depends(get_current_user),
):
    q = {"user_id": user["id"]}
    rows = await db.recurrences.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    base_currency = normalize_currency(user.get("currency"))
    currencies = await account_currency_map(user)
    for row in rows:
        row["currency"] = normalize_currency(
            row.get("currency"), currencies.get(row.get("account_id"), base_currency)
        )
        row["base_amount"] = round(amount_in_currency(row, base_currency), 2)
    if currency:
        selected_currency = normalize_currency(currency)
        rows = [row for row in rows if row["currency"] == selected_currency]
    return rows


@api.post("/recurrences")
async def create_recurrence(
    payload: RecurrenceIn,
    user=Depends(get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    async def create():
        await validate_transaction_person(payload.person_id, user)
        currencies = await account_currency_map(user)
        base_currency = normalize_currency(user.get("currency"))
        currency = currency_for_account(
            payload.currency, payload.account_id, currencies, base_currency
        )
        manual_rate = payload.exchange_rate if payload.rate_source != "automatic" else None
        meta = await monetary_metadata(currency, base_currency, payload.next_run, manual_rate)
        if payload.rate_source:
            meta["rate_source"] = payload.rate_source
        values = payload.model_dump(exclude={"currency", "exchange_rate", "rate_source"})
        doc = {"id": new_id(), "user_id": user["id"], **values, **meta, "created_at": now_iso()}
        await db.recurrences.insert_one(doc)
        doc.pop("_id", None)
        await materialize_recurrences(user["id"])
        return doc

    return await run_idempotent_create(
        "create_recurrence", user["id"], idempotency_key,
        payload.model_dump(), create,
    )


@api.put("/recurrences/{rid}")
async def update_recurrence(rid: str, payload: RecurrenceIn, user=Depends(get_current_user)):
    await validate_transaction_person(payload.person_id, user)
    currencies = await account_currency_map(user)
    base_currency = normalize_currency(user.get("currency"))
    currency = currency_for_account(
        payload.currency, payload.account_id, currencies, base_currency
    )
    manual_rate = payload.exchange_rate if payload.rate_source != "automatic" else None
    meta = await monetary_metadata(currency, base_currency, payload.next_run, manual_rate)
    if payload.rate_source:
        meta["rate_source"] = payload.rate_source
    values = payload.model_dump(exclude={"currency", "exchange_rate", "rate_source"})
    res = await db.recurrences.update_one(
        {"id": rid, "user_id": user["id"]}, {"$set": {**values, **meta}})
    if res.matched_count == 0:
        raise HTTPException(404, "Recorrência não encontrada")
    # Keep linked lançamentos in sync (update, never duplicate). Only the
    # not-yet-paid (pending) materialized occurrences are updated; already-paid
    # past entries are kept as historical record.
    await db.transactions.update_many(
        {"user_id": user["id"], "recurrence_id": rid, "status": "pending"},
        {"$set": {
            "type": payload.type, "amount": payload.amount,
            "category_id": payload.category_id, "person_id": payload.person_id,
            "account_id": payload.account_id,
            "payment_method": payload.payment_method, "description": payload.description,
            **meta,
        }},
    )
    return await db.recurrences.find_one({"id": rid}, {"_id": 0})


@api.post("/recurrences/{rid}/toggle")
async def toggle_recurrence(rid: str, user=Depends(get_current_user)):
    r = await db.recurrences.find_one({"id": rid, "user_id": user["id"]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Recorrência não encontrada")
    await db.recurrences.update_one({"id": rid}, {"$set": {"active": not r.get("active", True)}})
    return {"ok": True, "active": not r.get("active", True)}


@api.delete("/recurrences/{rid}")
async def delete_recurrence(rid: str, user=Depends(get_current_user)):
    await db.recurrences.delete_one({"id": rid, "user_id": user["id"]})
    # Also remove FUTURE materialized transactions generated by this recurrence
    # (strictly after today). Past/already-occurred entries remain as history.
    today = datetime.now(timezone.utc).date().isoformat()
    res = await db.transactions.delete_many(
        {"user_id": user["id"], "recurrence_id": rid, "date": {"$gt": today}})
    return {"ok": True, "deleted_future": res.deleted_count}


# ---------- Installments ----------
@api.get("/installments/purchases")
async def list_purchases(
    currency: Optional[str] = None,
    user=Depends(get_current_user),
):
    q = {"user_id": user["id"]}
    purchases = await db.installment_purchases.find(
        q, {"_id": 0}
    ).to_list(500)
    base_currency = normalize_currency(user.get("currency"))
    currencies = await account_currency_map(user)
    for p in purchases:
        p["currency"] = normalize_currency(
            p.get("currency"), currencies.get(p.get("account_id"), base_currency)
        )
        p["base_total_amount"] = round(
            amount_in_currency({**p, "amount": p.get("total_amount", 0)}, base_currency),
            2,
        )
        p["installments_list"] = await db.installments.find(
            {"purchase_id": p["id"]}, {"_id": 0}
        ).sort("number", 1).to_list(200)
        for installment in p["installments_list"]:
            installment["currency"] = p["currency"]
            installment["base_amount"] = round(
                amount_in_currency({**p, "amount": installment.get("amount", 0)}, base_currency),
                2,
            )
    if currency:
        selected_currency = normalize_currency(currency)
        purchases = [p for p in purchases if p["currency"] == selected_currency]
    return purchases


@api.post("/installments/purchases")
async def create_purchase(
    payload: InstallmentPurchaseIn,
    user=Depends(get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    async def create():
        pid = new_id()
        per = round(payload.total_amount / payload.installments, 2)
        base_date = datetime.fromisoformat(payload.first_date)
        currencies = await account_currency_map(user)
        base_currency = normalize_currency(user.get("currency"))
        currency = currency_for_account(
            payload.currency, payload.account_id, currencies, base_currency
        )
        meta = await monetary_metadata(currency, base_currency, payload.first_date, payload.exchange_rate)
        values = payload.model_dump(exclude={"currency", "exchange_rate"})
        purchase = {
            "id": pid, "user_id": user["id"], **values, **meta,
            "created_at": now_iso(),
        }
        await db.installment_purchases.insert_one(purchase)
        inst_docs = []
        try:
            for i in range(payload.installments):
                m = base_date.month - 1 + i
                y = base_date.year + m // 12
                mm = m % 12 + 1
                try:
                    d = base_date.replace(year=y, month=mm)
                except ValueError:
                    d = base_date.replace(year=y, month=mm, day=28)
                inst_docs.append({
                    "id": new_id(), "purchase_id": pid, "user_id": user["id"],
                    "number": i + 1, "total": payload.installments,
                    "amount": per, "due_date": d.date().isoformat(),
                    "status": "pending", "paid_at": None,
                })
            if inst_docs:
                await db.installments.insert_many(inst_docs)
                for item in inst_docs:
                    item.pop("_id", None)
        except Exception:
            await db.installments.delete_many({"purchase_id": pid})
            await db.installment_purchases.delete_one({"id": pid, "user_id": user["id"]})
            raise
        purchase["installments_list"] = inst_docs
        purchase.pop("_id", None)
        return purchase

    return await run_idempotent_create(
        "create_installment_purchase", user["id"], idempotency_key,
        payload.model_dump(), create,
    )


class InstallmentPurchaseUpdateIn(BaseModel):
    description: Optional[str] = None
    category_id: Optional[str] = None
    payment_method: Optional[str] = None
    account_id: Optional[str] = None


@api.put("/installments/purchases/{pid}")
async def update_purchase(pid: str, payload: InstallmentPurchaseUpdateIn, user=Depends(get_current_user)):
    upd = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if not upd:
        return {"ok": True}
    current = await db.installment_purchases.find_one(
        {"id": pid, "user_id": user["id"]}, {"_id": 0}
    )
    if not current:
        raise HTTPException(404, "Não encontrado")
    if payload.account_id:
        currencies = await account_currency_map(user)
        purchase_currency = normalize_currency(
            current.get("currency"), user.get("currency", "EUR")
        )
        account_currency = currencies.get(payload.account_id)
        if not account_currency:
            raise HTTPException(404, "Carteira não encontrada")
        if account_currency != purchase_currency:
            raise HTTPException(
                400,
                "A carteira deve usar a mesma moeda do parcelamento",
            )
    res = await db.installment_purchases.update_one(
        {"id": pid, "user_id": user["id"]},
        {"$set": upd},
    )
    if not res.matched_count:
        raise HTTPException(404, "Não encontrado")
    return {"ok": True}


@api.post("/installments/{iid}/pay")
async def mark_installment(iid: str, user=Depends(get_current_user)):
    inst = await db.installments.find_one({"id": iid, "user_id": user["id"]})
    if not inst:
        raise HTTPException(404, "Parcela não encontrada")
    new_status = "pending" if inst["status"] == "paid" else "paid"
    await db.installments.update_one(
        {"id": iid},
        {"$set": {"status": new_status, "paid_at": now_iso() if new_status == "paid" else None}},
    )
    return {"ok": True, "status": new_status}


@api.delete("/installments/purchases/{pid}")
async def delete_purchase(pid: str, user=Depends(get_current_user)):
    await db.installment_purchases.delete_one({"id": pid, "user_id": user["id"]})
    await db.installments.delete_many({"purchase_id": pid})
    return {"ok": True}


# ---------- Receivables ----------
@api.get("/receivables")
async def list_receivables(
    currency: Optional[str] = None,
    user=Depends(get_current_user),
):
    q = {"user_id": user["id"]}
    rows = await db.receivables.find(q, {"_id": 0}).sort("due_date", 1).to_list(500)
    base_currency = normalize_currency(user.get("currency"))
    currencies = await account_currency_map(user)
    for row in rows:
        row["currency"] = normalize_currency(
            row.get("currency"), currencies.get(row.get("account_id"), base_currency)
        )
        row["base_amount"] = round(amount_in_currency(row, base_currency), 2)
    if currency:
        selected_currency = normalize_currency(currency)
        rows = [row for row in rows if row["currency"] == selected_currency]
    return rows


@api.post("/receivables")
async def create_receivable(
    payload: ReceivableIn,
    user=Depends(get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    async def create():
        currencies = await account_currency_map(user)
        base_currency = normalize_currency(user.get("currency"))
        currency = currency_for_account(
            payload.currency, payload.account_id, currencies, base_currency
        )
        meta = await monetary_metadata(currency, base_currency, payload.due_date, payload.exchange_rate)
        values = payload.model_dump(exclude={"currency", "exchange_rate"})
        doc = {"id": new_id(), "user_id": user["id"], **values, **meta,
               "status": "pending", "received_at": None, "created_at": now_iso()}
        await db.receivables.insert_one(doc)
        doc.pop("_id", None)
        return doc

    return await run_idempotent_create(
        "create_receivable", user["id"], idempotency_key,
        payload.model_dump(), create,
    )


@api.put("/receivables/{rid}")
async def update_receivable(rid: str, payload: ReceivableIn, user=Depends(get_current_user)):
    currencies = await account_currency_map(user)
    base_currency = normalize_currency(user.get("currency"))
    currency = currency_for_account(
        payload.currency, payload.account_id, currencies, base_currency
    )
    meta = await monetary_metadata(currency, base_currency, payload.due_date, payload.exchange_rate)
    values = payload.model_dump(exclude={"currency", "exchange_rate"})
    res = await db.receivables.update_one(
        {"id": rid, "user_id": user["id"]},
        {"$set": {**values, **meta}},
    )
    if not res.matched_count:
        raise HTTPException(404, "Não encontrado")
    return {"ok": True}


@api.post("/receivables/{rid}/receive")
async def receive_receivable(rid: str, user=Depends(get_current_user)):
    r = await db.receivables.find_one({"id": rid, "user_id": user["id"]})
    if not r:
        raise HTTPException(404, "Não encontrado")
    new_status = "pending" if r["status"] == "received" else "received"
    if new_status == "received":
        # Create an income transaction so it counts as receita AND credits the wallet
        tx_id = new_id()
        desc = (r.get("description") or r.get("person") or "").strip()
        await db.transactions.insert_one({
            "id": tx_id, "user_id": user["id"], "type": "income",
            "date": datetime.now(timezone.utc).date().isoformat(),
            "amount": r["amount"], "category_id": None,
            "account_id": r.get("account_id"),
            "from_account_id": None, "to_account_id": None,
            "payment_method": None,
            "description": f"Recebimento: {desc}" if desc else "Recebimento",
            "notes": "(conta a receber)", "status": "paid",
            "receivable_id": rid, "created_at": now_iso(),
            "currency": r.get("currency"),
            "exchange_rates": r.get("exchange_rates"),
            "base_currency_at_creation": r.get("base_currency_at_creation"),
            "exchange_rate_to_base": r.get("exchange_rate_to_base"),
            "rate_date": r.get("rate_date"),
            "rate_source": r.get("rate_source"),
        })
        await db.receivables.update_one(
            {"id": rid},
            {"$set": {"status": "received", "received_at": now_iso(), "received_tx_id": tx_id}},
        )
    else:
        # Reverting to pending: remove the linked income transaction
        if r.get("received_tx_id"):
            await db.transactions.delete_one(
                {"id": r["received_tx_id"], "user_id": user["id"]})
        await db.receivables.update_one(
            {"id": rid},
            {"$set": {"status": "pending", "received_at": None, "received_tx_id": None}},
        )
    return {"ok": True, "status": new_status}


@api.delete("/receivables/{rid}")
async def delete_receivable(rid: str, user=Depends(get_current_user)):
    r = await db.receivables.find_one({"id": rid, "user_id": user["id"]}, {"_id": 0})
    if r and r.get("received_tx_id"):
        await db.transactions.delete_one(
            {"id": r["received_tx_id"], "user_id": user["id"]})
    await db.receivables.delete_one({"id": rid, "user_id": user["id"]})
    return {"ok": True}


# ---------- Groups ----------
def group_admin_ids(group: dict) -> set[str]:
    """Return local group administrators, including legacy group creators."""
    admins = set(group.get("admin_ids") or [])
    if group.get("creator_id"):
        admins.add(group["creator_id"])
    return admins


def is_group_admin(group: dict, user_id: str) -> bool:
    return user_id in group_admin_ids(group)


def group_member_summary(member: dict, group: dict) -> dict:
    summary = public_user(member)
    is_owner = member["id"] == group.get("creator_id")
    is_admin = is_group_admin(group, member["id"])
    summary.update({
        "group_role": "owner" if is_owner else ("admin" if is_admin else "member"),
        "is_group_owner": is_owner,
        "is_group_admin": is_admin,
    })
    return summary


async def find_group_for_admin(gid: str, user_id: str) -> dict:
    group = await db.groups.find_one({"id": gid, "member_ids": user_id})
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    if not is_group_admin(group, user_id):
        raise HTTPException(
            403,
            "Apenas administradores do grupo podem realizar esta ação",
        )
    return group


@api.get("/groups")
async def list_groups(user=Depends(get_current_user)):
    groups = await db.groups.find(
        {"member_ids": user["id"]}, {"_id": 0}
    ).to_list(200)
    for g in groups:
        members = await db.users.find(
            {"id": {"$in": g.get("member_ids", [])}}, {"_id": 0, "password_hash": 0}
        ).to_list(50)
        g["admin_ids"] = sorted(group_admin_ids(g))
        g["members"] = [group_member_summary(m, g) for m in members]
        is_owner = g.get("creator_id") == user["id"]
        can_manage = is_group_admin(g, user["id"])
        g["current_user_role"] = (
            "owner" if is_owner else ("admin" if can_manage else "member")
        )
        g["can_manage_members"] = can_manage
        g["can_delete_group"] = is_owner
    return groups


@api.post("/groups")
async def create_group(
    payload: GroupIn,
    user=Depends(get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    async def create():
        member_ids = [user["id"]]
        for em in payload.member_emails:
            u = await db.users.find_one({
                "email": em.lower(),
                "$or": [
                    {"status": "active"},
                    {"status": {"$exists": False}},
                ],
            })
            if u and u["id"] not in member_ids:
                member_ids.append(u["id"])
        doc = {
            "id": new_id(), "name": payload.name, "description": payload.description,
            "creator_id": user["id"], "member_ids": member_ids,
            "admin_ids": [user["id"]], "created_at": now_iso(),
        }
        await db.groups.insert_one(doc)
        doc.pop("_id", None)
        for mid in member_ids:
            if mid != user["id"]:
                try:
                    await push_notification(
                        mid, "group_added", "Adicionado a um grupo",
                        f"{user['name']} adicionou você ao grupo '{payload.name}'.",
                        "/grupos", {"group_id": doc["id"]},
                    )
                except Exception as exc:
                    logger.warning("Group notification failed for %s: %s", mid, exc)
        return doc

    return await run_idempotent_create(
        "create_group", user["id"], idempotency_key,
        payload.model_dump(), create,
    )


@api.post("/groups/{gid}/members")
async def add_group_member(gid: str, body: dict, user=Depends(get_current_user)):
    email = body.get("email", "").lower()
    group = await find_group_for_admin(gid, user["id"])
    u = await db.users.find_one({
        "email": email,
        "$or": [
            {"status": "active"},
            {"status": {"$exists": False}},
        ],
    })
    if not u:
        raise HTTPException(404, "Usuário não encontrado")
    if u["id"] in group.get("member_ids", []):
        return {"ok": True, "already_member": True}
    await db.groups.update_one({"id": gid}, {"$addToSet": {"member_ids": u["id"]}})
    try:
        await push_notification(
            u["id"], "group_added", "Adicionado a um grupo",
            f"{user['name']} adicionou você ao grupo '{group['name']}'.",
            "/grupos", {"group_id": gid},
        )
    except Exception as exc:
        logger.warning("Group notification failed for %s: %s", u["id"], exc)
    return {"ok": True}


class GroupUpdateIn(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


@api.put("/groups/{gid}")
async def update_group(gid: str, payload: GroupUpdateIn, user=Depends(get_current_user)):
    await find_group_for_admin(gid, user["id"])
    upd = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if upd:
        await db.groups.update_one({"id": gid}, {"$set": upd})
    return {"ok": True}


@api.delete("/groups/{gid}/members/{uid}")
async def remove_group_member(gid: str, uid: str, user=Depends(get_current_user)):
    g = await find_group_for_admin(gid, user["id"])
    if uid == g["creator_id"]:
        raise HTTPException(400, "Não é possível remover o proprietário do grupo")
    if uid not in g.get("member_ids", []):
        raise HTTPException(404, "Membro não encontrado")
    await db.groups.update_one(
        {"id": gid},
        {"$pull": {"member_ids": uid, "admin_ids": uid}},
    )
    return {"ok": True}


@api.patch("/groups/{gid}/members/{uid}/role")
async def update_group_member_role(
    gid: str,
    uid: str,
    payload: GroupMemberRoleIn,
    user=Depends(get_current_user),
):
    group = await find_group_for_admin(gid, user["id"])
    if uid == group.get("creator_id"):
        raise HTTPException(400, "O papel do proprietário do grupo é protegido")
    if uid not in group.get("member_ids", []):
        raise HTTPException(404, "Membro não encontrado")
    currently_admin = uid in group_admin_ids(group)
    if (payload.role == "admin") == currently_admin:
        return {"ok": True, "role": payload.role, "unchanged": True}

    if payload.role == "admin":
        update = {"$addToSet": {"admin_ids": uid}}
    else:
        update = {"$pull": {"admin_ids": uid}}
    await db.groups.update_one({"id": gid}, update)

    try:
        await push_notification(
            uid,
            "group_role_changed",
            "Função no grupo atualizada",
            (
                f"{user['name']} definiu você como "
                f"{'administrador' if payload.role == 'admin' else 'membro'} "
                f"do grupo '{group['name']}'."
            ),
            "/grupos",
            {"group_id": gid, "group_role": payload.role},
        )
    except Exception as exc:
        logger.warning("Group role notification failed for %s: %s", uid, exc)
    return {"ok": True, "role": payload.role}


@api.delete("/groups/{gid}")
async def delete_group(gid: str, user=Depends(get_current_user)):
    g = await db.groups.find_one({"id": gid})
    if not g or g.get("creator_id") != user["id"]:
        raise HTTPException(403, "Sem permissão")
    await db.groups.delete_one({"id": gid})
    return {"ok": True}


# ---------- Private people ----------
def private_person_summary(person: dict) -> dict:
    return {
        "id": person["id"],
        "name": person.get("name", ""),
        "email": person.get("email"),
        "nickname": person.get("nickname", ""),
        "relationship": person.get("relationship", ""),
        "notes": person.get("notes", ""),
        "external": True,
        "avatar_color": person.get("avatar_color", "#7EA193"),
    }


@api.get("/people")
async def list_people(user=Depends(get_current_user)):
    items = await db.people.find(
        {"owner_user_id": user["id"]}, {"_id": 0}
    ).sort("name", 1).to_list(1000)
    return [private_person_summary(item) for item in items]


@api.post("/people")
async def create_person(
    payload: PersonIn,
    user=Depends(get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    async def create():
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "Nome é obrigatório")
        doc = {
            "id": new_id(),
            "owner_user_id": user["id"],
            "name": name,
            "email": str(payload.email).strip().lower() if payload.email else None,
            "nickname": payload.nickname.strip(),
            "relationship": payload.relationship.strip(),
            "notes": payload.notes.strip(),
            "avatar_color": "#7EA193",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.people.insert_one(doc)
        doc.pop("_id", None)
        return private_person_summary(doc)

    return await run_idempotent_create(
        "create_person", user["id"], idempotency_key,
        payload.model_dump(), create,
    )


@api.put("/people/{person_id}")
async def update_person(
    person_id: str,
    payload: PersonIn,
    user=Depends(get_current_user),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Nome é obrigatório")
    result = await db.people.update_one(
        {"id": person_id, "owner_user_id": user["id"]},
        {"$set": {
            "name": name,
            "email": str(payload.email).strip().lower() if payload.email else None,
            "nickname": payload.nickname.strip(),
            "relationship": payload.relationship.strip(),
            "notes": payload.notes.strip(),
            "updated_at": now_iso(),
        }},
    )
    if not result.matched_count:
        raise HTTPException(404, "Pessoa não encontrada")
    return {"ok": True}


@api.delete("/people/{person_id}")
async def delete_person(person_id: str, user=Depends(get_current_user)):
    person = await db.people.find_one(
        {"id": person_id, "owner_user_id": user["id"]}, {"_id": 0}
    )
    if not person:
        raise HTTPException(404, "Pessoa não encontrada")
    shared_in_use, transactions_in_use, recurrences_in_use = await asyncio.gather(
        db.shared_expenses.count_documents({
            "creator_id": user["id"],
            "$or": [
                {"payer_id": person_id},
                {"participants.person_id": person_id},
            ],
        }),
        db.transactions.count_documents({
            "user_id": user["id"],
            "person_id": person_id,
        }),
        db.recurrences.count_documents({
            "user_id": user["id"],
            "person_id": person_id,
        }),
    )
    if shared_in_use or transactions_in_use or recurrences_in_use:
        raise HTTPException(
            409,
            "Esta pessoa possui histórico financeiro e não pode ser excluída. Edite o cadastro para preservar os registros.",
        )
    await db.people.delete_one({"id": person_id, "owner_user_id": user["id"]})
    return {"ok": True}


# ---------- Shared Expenses ----------
def participant_reference(participant: dict) -> Optional[str]:
    return (
        participant.get("participant_id")
        or participant.get("user_id")
        or participant.get("person_id")
    )


def visible_shared_query(user_id: str) -> dict:
    return {
        "$or": [
            {"participant_ids": user_id},
            {"creator_id": user_id},
        ]
    }


async def shared_party_map(expenses: List[dict], language: str = "pt") -> dict:
    user_ids = set()
    person_ids = set()
    for expense in expenses:
        payer_id = expense.get("payer_id")
        for participant in expense.get("participants", []):
            reference = participant_reference(participant)
            if participant.get("person_id"):
                person_ids.add(reference)
            elif reference:
                user_ids.add(reference)
        if payer_id and payer_id not in person_ids:
            user_ids.add(payer_id)

    users = (
        await db.users.find(
            {"id": {"$in": list(user_ids)}},
            {"_id": 0, "password_hash": 0},
        ).to_list(1000)
        if user_ids else []
    )
    people = (
        await db.people.find(
            {"id": {"$in": list(person_ids)}}, {"_id": 0}
        ).to_list(1000)
        if person_ids else []
    )
    party_map = {item["id"]: public_user(item) for item in users}
    party_map.update({item["id"]: private_person_summary(item) for item in people})
    for reference in user_ids:
        party_map.setdefault(reference, deleted_user_summary(reference, language))
    for reference in person_ids:
        party_map.setdefault(reference, {
            "id": reference,
            "name": "Pessoa externa",
            "external": True,
            "avatar_color": "#7EA193",
        })
    return party_map


def compute_splits(amount: float, split_type: str, participants: List[dict]) -> List[dict]:
    n = len(participants)
    out = []
    if not n:
        return out

    def split_base(participant: dict) -> dict:
        reference = participant_reference(participant)
        return {
            "participant_id": reference,
            "user_id": participant.get("user_id"),
            "person_id": participant.get("person_id"),
            "owed": 0,
            "paid_back": False,
        }

    if split_type == "equal":
        per = round(amount / n, 2)
        for p in participants:
            out.append({**split_base(p), "owed": per})
        # adjust rounding diff on last
        diff = round(amount - per * n, 2)
        if out and diff:
            out[-1]["owed"] = round(out[-1]["owed"] + diff, 2)
    elif split_type == "manual":
        for p in participants:
            out.append({**split_base(p), "owed": float(p.get("amount") or 0)})
    elif split_type == "percent":
        for p in participants:
            out.append({
                **split_base(p),
                "owed": round(amount * float(p.get("percent") or 0) / 100.0, 2),
            })
    return out


def shared_expense_status(expense: dict) -> str:
    participants = expense.get("participants") or []
    payer_id = expense.get("payer_id")
    debts = [
        participant
        for participant in participants
        if participant_reference(participant) != payer_id
        and float(participant.get("owed") or 0) > 0.005
    ]
    if debts and all(participant.get("paid_back") is True for participant in debts):
        return "finalized"
    if any(participant.get("paid_back") is True for participant in debts):
        return "partial"
    return "open"


async def validate_shared_expense_account(
    account_id: Optional[str],
    payer_id: str,
    user: dict,
    currency: str,
) -> Optional[dict]:
    if not account_id:
        return None
    if payer_id != user["id"]:
        raise HTTPException(
            400,
            "Somente quem pagou pode vincular uma carteira própria",
        )
    account = await db.accounts.find_one(
        {"id": account_id, "user_id": user["id"]},
        {"_id": 0},
    )
    if not account:
        raise HTTPException(404, "Carteira não encontrada")
    account_currency = normalize_currency(
        account.get("currency"),
        user.get("currency", "EUR"),
    )
    if account_currency != currency:
        raise HTTPException(
            400,
            "A moeda da despesa deve ser igual à moeda da carteira",
        )
    return account


async def sync_shared_expense_transaction(expense: dict, payer: dict) -> Optional[dict]:
    """Keep one wallet transaction linked to a shared expense.

    The shared expense remains the source of truth. The linked row only exposes
    the real wallet outflow in transactions, balances and statements.
    """
    query = {
        "shared_expense_id": expense["id"],
        "user_id": payer["id"],
    }
    account_id = expense.get("account_id")
    if expense.get("payer_id") != payer["id"] or not account_id:
        await db.transactions.delete_many(query)
        return None

    currency = normalize_currency(
        expense.get("currency"),
        payer.get("currency", "EUR"),
    )
    values = {
        "user_id": payer["id"],
        "type": "expense",
        "date": expense["date"],
        "amount": float(expense["amount"]),
        "category_id": (
            expense.get("category_id")
            if expense.get("creator_id") == payer["id"]
            else None
        ),
        "person_id": None,
        "account_id": account_id,
        "from_account_id": None,
        "to_account_id": None,
        "payment_method": None,
        "description": expense.get("title", ""),
        "notes": expense.get("notes", ""),
        "status": "paid",
        "currency": currency,
        "exchange_rates": expense.get("exchange_rates"),
        "base_currency_at_creation": expense.get("base_currency_at_creation"),
        "exchange_rate_to_base": expense.get("exchange_rate_to_base"),
        "rate_date": expense.get("rate_date"),
        "rate_source": expense.get("rate_source"),
        "source": "shared_expense",
        "shared_expense_id": expense["id"],
        "editable": False,
        "updated_at": now_iso(),
    }
    existing = await db.transactions.find_one(query, {"_id": 0})
    if existing:
        await db.transactions.update_one(
            {"id": existing["id"], **query},
            {"$set": values},
        )
        return {**existing, **values}

    doc = {
        "id": new_id(),
        **values,
        "created_at": now_iso(),
    }
    await db.transactions.insert_one(doc)
    doc.pop("_id", None)
    return doc


def normalized_search_text(value: object) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "").casefold())
    return "".join(char for char in normalized if not unicodedata.combining(char))


async def record_settlement(expense: dict, debtor_id: str, paid_at: str) -> None:
    participant = next(
        (
            item for item in expense.get("participants", [])
            if participant_reference(item) == debtor_id
        ),
        None,
    )
    if not participant or debtor_id == expense.get("payer_id"):
        return
    await db.settlement_history.update_one(
        {"expense_id": expense["id"], "debtor_id": debtor_id},
        {"$setOnInsert": {
            "id": new_id(),
            "expense_id": expense["id"],
            "expense_title": expense.get("title", ""),
            "expense_date": expense.get("date"),
            "category": expense.get("category") or "",
            "notes": expense.get("notes") or "",
            "debtor_id": debtor_id,
            "creditor_id": expense["payer_id"],
            "amount": float(participant.get("owed") or 0),
            "currency": expense.get("currency", "EUR"),
            "paid_at": paid_at,
        }},
        upsert=True,
    )


async def confirm_shared_participant(expense: dict, debtor_id: str) -> tuple[dict, bool]:
    participant = next(
        (
            item for item in expense.get("participants", [])
            if participant_reference(item) == debtor_id
        ),
        None,
    )
    if not participant:
        raise HTTPException(404, "Participante não encontrado")
    if debtor_id == expense.get("payer_id"):
        return expense, False
    reference_field = (
        "participant_id"
        if participant.get("participant_id")
        else "person_id"
        if participant.get("person_id")
        else "user_id"
    )

    result = await db.shared_expenses.update_one(
        {
            "id": expense["id"],
            "status": {"$ne": "finalized"},
            "participants": {
                "$elemMatch": {
                    reference_field: debtor_id,
                    "paid_back": {"$ne": True},
                }
            },
        },
        {"$set": {"participants.$[participant].paid_back": True}},
        array_filters=[{f"participant.{reference_field}": debtor_id}],
    )
    changed = bool(result.matched_count)
    updated = await db.shared_expenses.find_one({"id": expense["id"]})
    if not updated:
        raise HTTPException(404, "Despesa não encontrada")
    if not changed:
        return updated, False

    paid_at = now_iso()
    status = shared_expense_status(updated)
    status_values = {"status": status, "updated_at": paid_at}
    if status == "finalized":
        status_values["completed_at"] = paid_at
    await db.shared_expenses.update_one(
        {"id": expense["id"]},
        {"$set": status_values},
    )
    updated.update(status_values)
    await record_settlement(updated, debtor_id, paid_at)
    if status == "finalized":
        await db.settlement_history.update_many(
            {"expense_id": expense["id"]},
            {"$set": {"expense_status": "finalized", "expense_completed_at": paid_at}},
        )
    return updated, True


async def backfill_shared_settlement_history() -> int:
    repaired = 0
    async for expense in db.shared_expenses.find(
        {
            "$or": [
                {"status": "finalized"},
                {"participants": {"$elemMatch": {"paid_back": True}}},
            ]
        },
        {"_id": 0},
    ):
        status = shared_expense_status(expense)
        completed_at = (
            expense.get("completed_at")
            or expense.get("updated_at")
            or expense.get("created_at")
            or (
                f"{expense['date']}T12:00:00+00:00"
                if expense.get("date")
                else now_iso()
            )
        )
        if status == "finalized" and expense.get("status") != "finalized":
            await db.shared_expenses.update_one(
                {"id": expense["id"]},
                {"$set": {"status": "finalized", "completed_at": completed_at}},
            )
            expense["status"] = "finalized"
            expense["completed_at"] = completed_at
        for participant in expense.get("participants", []):
            if (
                participant_reference(participant) != expense.get("payer_id")
                and participant.get("paid_back") is True
            ):
                await record_settlement(
                    expense,
                    participant_reference(participant),
                    completed_at,
                )
                repaired += 1
        if status == "finalized":
            await db.settlement_history.update_many(
                {"expense_id": expense["id"]},
                {
                    "$set": {
                        "expense_status": "finalized",
                        "expense_completed_at": completed_at,
                    }
                },
            )
    return repaired


@api.get("/shared-expenses")
async def list_shared(
    user=Depends(get_current_user),
    group_id: Optional[str] = None,
    currency: Optional[str] = None,
):
    q = {
        **visible_shared_query(user["id"]),
        "status": {"$ne": "finalized"},
    }
    if group_id:
        q["group_id"] = group_id
    items = await db.shared_expenses.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    # Also hide legacy rows whose participants are all paid but whose stored status
    # was never updated by older versions of the application.
    items = [item for item in items if shared_expense_status(item) != "finalized"]
    base_currency = normalize_currency(user.get("currency"))
    for item in items:
        item["currency"] = normalize_currency(item.get("currency"), base_currency)
        item["base_amount"] = round(amount_in_currency(item, base_currency), 2)
    if currency:
        selected_currency = normalize_currency(currency)
        items = [item for item in items if item["currency"] == selected_currency]
    party_map = await shared_party_map(items, user.get("language", "pt"))
    for it in items:
        it["payer"] = party_map.get(it["payer_id"])
        if it.get("payer_id") != user["id"]:
            # Wallet ownership is private even when the expense itself is shared.
            it.pop("account_id", None)
        for p in it["participants"]:
            p["participant_id"] = participant_reference(p)
            p["user"] = party_map.get(p["participant_id"])
    return items


async def push_notification(user_id: str, ntype: str, title: str, message: str,
                            link: str = "", meta: Optional[dict] = None):
    if not user_id:
        return
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "notif_prefs": 1})
    prefs = (u or {}).get("notif_prefs") or {}
    if prefs.get(ntype) is False:
        return
    doc = {
        "id": new_id(), "user_id": user_id, "type": ntype,
        "title": title, "message": message, "link": link,
        "meta": meta or {}, "read": False, "created_at": now_iso(),
    }
    await db.notifications.insert_one(doc)
    doc.pop("_id", None)
    unread = await db.notifications.count_documents({"user_id": user_id, "read": False})
    await ws_manager.send(user_id, {"event": "notification", "notification": doc, "unread": unread})


async def validate_shared_participants(
    payload: SharedExpenseIn,
    owner_user_id: str,
) -> tuple[List[dict], List[str]]:
    participants = [item.model_dump() for item in payload.participants]
    if not participants:
        raise HTTPException(400, "Adicione ao menos um participante")

    references = []
    user_ids = []
    person_ids = []
    for item in participants:
        user_id = item.get("user_id")
        person_id = item.get("person_id")
        if bool(user_id) == bool(person_id):
            raise HTTPException(400, "Informe um usuário ou uma pessoa externa por participante")
        reference = user_id or person_id
        if reference in references:
            raise HTTPException(400, "O mesmo participante foi adicionado mais de uma vez")
        item["participant_id"] = reference
        references.append(reference)
        if user_id:
            user_ids.append(user_id)
        else:
            person_ids.append(person_id)

    if payload.payer_id not in references:
        raise HTTPException(400, "Quem pagou precisa estar entre os participantes")

    if user_ids:
        found_users = await db.users.count_documents({"id": {"$in": user_ids}})
        if found_users != len(user_ids):
            raise HTTPException(404, "Um dos usuários participantes não foi encontrado")
    if person_ids:
        found_people = await db.people.count_documents({
            "id": {"$in": person_ids},
            "owner_user_id": owner_user_id,
        })
        if found_people != len(person_ids):
            raise HTTPException(404, "Uma das pessoas externas não foi encontrada")

    visible_user_ids = list(dict.fromkeys([owner_user_id, *user_ids]))
    return participants, visible_user_ids


@api.post("/shared-expenses")
async def create_shared(
    payload: SharedExpenseIn,
    user=Depends(get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    async def create():
        participants_in, participant_ids = await validate_shared_participants(
            payload, user["id"]
        )
        splits = compute_splits(payload.amount, payload.split_type, participants_in)
        currency = normalize_currency(payload.currency, user.get("currency", "EUR"))
        await validate_shared_expense_account(
            payload.account_id,
            payload.payer_id,
            user,
            currency,
        )
        meta = await monetary_metadata(currency, user.get("currency", "EUR"), payload.date, payload.exchange_rate)
        doc = {
            "id": new_id(), "creator_id": user["id"],
            "title": payload.title, "amount": payload.amount, "date": payload.date,
            "category": payload.category, "category_id": payload.category_id,
            "payer_id": payload.payer_id,
            "split_type": payload.split_type, "group_id": payload.group_id,
            "account_id": payload.account_id, "notes": payload.notes,
            **meta,
            "participants": splits, "participant_ids": participant_ids,
            "status": "open", "created_at": now_iso(),
        }
        await db.shared_expenses.insert_one(doc)
        doc.pop("_id", None)
        try:
            if payload.payer_id == user["id"] and payload.account_id:
                await sync_shared_expense_transaction(doc, user)
        except Exception:
            # The expense and its wallet outflow are one logical operation.
            # A failed linked transaction must not leave a half-created record.
            await db.shared_expenses.delete_one({"id": doc["id"]})
            raise

        payer = await db.users.find_one({"id": payload.payer_id}, {"_id": 0})
        if not payer:
            payer = await db.people.find_one({
                "id": payload.payer_id,
                "owner_user_id": user["id"],
            }, {"_id": 0})
        payer_name = payer["name"] if payer else "alguém"
        for participant in splits:
            participant_user_id = participant.get("user_id")
            if not participant_user_id or participant_user_id == user["id"]:
                continue
            is_payer = participant_user_id == payload.payer_id
            msg = (f"{user['name']} adicionou você na despesa '{payload.title}' "
                   f"({fmt_eur(payload.amount, currency)})"
                   + ("" if is_payer else f". Você deve {fmt_eur(participant['owed'], currency)} para {payer_name}."))
            try:
                await push_notification(
                    participant_user_id, "shared_expense_added",
                    "Nova despesa compartilhada", msg,
                    "/despesas-compartilhadas", {"expense_id": doc["id"]},
                )
            except Exception as exc:
                logger.warning(
                    "Shared-expense notification failed for %s: %s",
                    participant_user_id, exc,
                )
        return doc

    return await run_idempotent_create(
        "create_shared_expense", user["id"], idempotency_key,
        payload.model_dump(), create,
    )


def fmt_eur(v: float, currency: str = "EUR") -> str:
    symbol = {"EUR": "€", "BRL": "R$", "USD": "$", "CHF": "CHF"}.get(currency, currency)
    return f"{symbol} {v:.2f}"


@api.post("/shared-expenses/{sid}/settle/{participant_id}")
async def settle_participant(sid: str, participant_id: str, user=Depends(get_current_user)):
    se = await db.shared_expenses.find_one({
        "id": sid,
        **visible_shared_query(user["id"]),
    })
    if not se:
        raise HTTPException(404, "Despesa não encontrada")
    target = next(
        (
            item for item in se.get("participants", [])
            if participant_reference(item) == participant_id
        ),
        None,
    )
    if target and target.get("person_id") and se.get("creator_id") != user["id"]:
        raise HTTPException(403, "Apenas quem cadastrou a pessoa externa pode confirmar o acerto")
    updated, changed = await confirm_shared_participant(se, participant_id)
    status = shared_expense_status(updated)
    # Notify the payer when someone marks as paid
    if changed and participant_id != se["payer_id"]:
        debtor = await db.users.find_one({"id": participant_id}, {"_id": 0})
        creditor = await db.users.find_one({"id": se["payer_id"]}, {"_id": 0})
        amount = next(
            (
                p["owed"] for p in updated["participants"]
                if participant_reference(p) == participant_id
            ),
            0,
        )
        if creditor:
            await push_notification(
                se["payer_id"], "settlement_paid",
                "Acerto recebido",
                f"{debtor['name'] if debtor else 'Alguém'} marcou {fmt_eur(amount, se.get('currency', 'EUR'))} como pago em '{se['title']}'.",
                "/acertos", {"expense_id": sid},
            )
    return {
        "ok": True,
        "status": status,
        "paid_back": True,
        "already_confirmed": not changed,
    }


@api.put("/shared-expenses/{sid}/account")
async def link_shared_expense_account(
    sid: str,
    payload: SharedExpenseAccountIn,
    user=Depends(get_current_user),
):
    expense = await db.shared_expenses.find_one({
        "id": sid,
        **visible_shared_query(user["id"]),
    })
    if not expense:
        raise HTTPException(404, "Despesa não encontrada")
    if expense.get("payer_id") != user["id"]:
        raise HTTPException(403, "Somente quem pagou pode vincular a carteira")
    currency = normalize_currency(
        expense.get("currency"),
        user.get("currency", "EUR"),
    )
    await validate_shared_expense_account(
        payload.account_id,
        user["id"],
        user,
        currency,
    )
    await db.shared_expenses.update_one(
        {"id": sid},
        {"$set": {
            "account_id": payload.account_id,
            "updated_at": now_iso(),
        }},
    )
    expense["account_id"] = payload.account_id
    await sync_shared_expense_transaction(expense, user)
    return {"ok": True, "account_id": payload.account_id}


# ---------- Notifications ----------
@api.get("/notifications")
async def list_notifications(user=Depends(get_current_user), limit: int = 30):
    items = await db.notifications.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    return items


@api.get("/notifications/unread-count")
async def unread_count(user=Depends(get_current_user)):
    n = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"count": n}


@api.post("/notifications/{nid}/read")
async def mark_read(nid: str, user=Depends(get_current_user)):
    await db.notifications.update_one(
        {"id": nid, "user_id": user["id"]}, {"$set": {"read": True}}
    )
    return {"ok": True}


@api.post("/notifications/read-all")
async def mark_all_read(user=Depends(get_current_user)):
    await db.notifications.update_many(
        {"user_id": user["id"], "read": False}, {"$set": {"read": True}}
    )
    return {"ok": True}


@api.delete("/notifications/{nid}")
async def delete_notification(nid: str, user=Depends(get_current_user)):
    await db.notifications.delete_one({"id": nid, "user_id": user["id"]})
    return {"ok": True}


class NotifPrefsIn(BaseModel):
    prefs: dict


@api.get("/notifications/preferences")
async def get_notif_prefs(user=Depends(get_current_user)):
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "notif_prefs": 1})
    prefs = (u or {}).get("notif_prefs") or {}
    return {t: prefs.get(t, True) for t in NOTIF_TYPES}


@api.put("/notifications/preferences")
async def set_notif_prefs(body: NotifPrefsIn, user=Depends(get_current_user)):
    clean = {t: bool(body.prefs.get(t, True)) for t in NOTIF_TYPES}
    await db.users.update_one({"id": user["id"]}, {"$set": {"notif_prefs": clean}})
    return clean


@api.post("/notifications/ws-ticket")
async def create_ws_ticket(user=Depends(get_current_user)):
    raw_ticket = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=WS_TICKET_TTL_SECONDS)

    await db.websocket_tickets.delete_many({
        "user_id": user["id"],
        "used_at": None,
    })
    await db.websocket_tickets.insert_one({
        "id": new_id(),
        "user_id": user["id"],
        "session_version": int(user.get("session_version", 0)),
        "ticket_hash": hash_ws_ticket(raw_ticket),
        "created_at": now,
        "expires_at": expires_at,
        "used_at": None,
    })
    return {
        "ticket": raw_ticket,
        "expires_in": WS_TICKET_TTL_SECONDS,
    }


@app.websocket("/api/ws/notifications")
async def ws_notifications(websocket: WebSocket):
    if not websocket_origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    user_id = None
    try:
        auth_message = await asyncio.wait_for(
            websocket.receive_json(),
            timeout=WS_AUTH_TIMEOUT_SECONDS,
        )
        if (
            not isinstance(auth_message, dict)
            or auth_message.get("type") != "authenticate"
        ):
            await websocket.close(code=4401)
            return

        user, status = await consume_ws_ticket(auth_message.get("ticket"))
        if not user:
            await websocket.close(
                code=4001 if status == "invalid_session" else 4401
            )
            return

        user_id = user["id"]
        ws_manager.connect(user_id, websocket)
        unread = await db.notifications.count_documents({"user_id": user_id, "read": False})
        await websocket.send_json({
            "event": "authenticated",
            "unread": unread,
        })
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except asyncio.TimeoutError:
        await websocket.close(code=4408)
    except Exception:
        logger.exception("WebSocket notification connection failed")
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        if user_id:
            ws_manager.disconnect(user_id, websocket)


@api.put("/shared-expenses/{sid}")
async def update_shared(sid: str, payload: SharedExpenseIn, user=Depends(get_current_user)):
    se = await db.shared_expenses.find_one({"id": sid})
    if not se:
        raise HTTPException(404, "Não encontrado")
    if se["creator_id"] != user["id"]:
        raise HTTPException(403, "Apenas o criador pode editar")
    participants_in, participant_ids = await validate_shared_participants(
        payload, user["id"]
    )
    splits = compute_splits(payload.amount, payload.split_type, participants_in)
    currency = normalize_currency(payload.currency, se.get("currency", user.get("currency", "EUR")))
    effective_account_id = (
        payload.account_id
        if payload.payer_id == user["id"]
        else se.get("account_id")
        if payload.payer_id == se.get("payer_id")
        else None
    )
    await validate_shared_expense_account(
        effective_account_id if payload.payer_id == user["id"] else None,
        payload.payer_id,
        user,
        currency,
    )
    meta = await monetary_metadata(currency, user.get("currency", "EUR"), payload.date, payload.exchange_rate)
    # preserve paid_back state
    existing_paid = {
        participant_reference(p): p.get("paid_back", False)
        for p in se.get("participants", [])
    }
    for p in splits:
        p["paid_back"] = existing_paid.get(participant_reference(p), False)
    await db.shared_expenses.update_one(
        {"id": sid},
        {"$set": {
            "title": payload.title, "amount": payload.amount, "date": payload.date,
            "category": payload.category, "category_id": payload.category_id,
            "payer_id": payload.payer_id,
            "split_type": payload.split_type, "group_id": payload.group_id,
            "account_id": effective_account_id,
            "notes": payload.notes, "participants": splits,
            "participant_ids": participant_ids,
            **meta,
        }},
    )
    updated = {
        **se,
        **payload.model_dump(exclude={"currency", "exchange_rate", "account_id"}),
        **meta,
        "account_id": effective_account_id,
        "participants": splits,
        "participant_ids": participant_ids,
    }
    await db.transactions.delete_many({
        "shared_expense_id": sid,
        "user_id": {"$ne": payload.payer_id},
    })
    payer = (
        user
        if payload.payer_id == user["id"]
        else await db.users.find_one(
            {"id": payload.payer_id},
            {"_id": 0, "password_hash": 0},
        )
    )
    if payer:
        await sync_shared_expense_transaction(updated, payer)
    return {"ok": True}


@api.delete("/shared-expenses/{sid}")
async def delete_shared(sid: str, user=Depends(get_current_user)):
    se = await db.shared_expenses.find_one({"id": sid})
    if not se:
        raise HTTPException(404, "Não encontrado")
    if se["creator_id"] != user["id"] and se["payer_id"] != user["id"]:
        raise HTTPException(403, "Apenas o criador ou o pagador pode excluir")
    await db.shared_expenses.delete_one({"id": sid})
    await db.transactions.delete_many({"shared_expense_id": sid})
    return {"ok": True}


# ---------- Settlements ----------
@api.post("/settlements/settle-between/{other_id}")
async def settle_between(other_id: str, user=Depends(get_current_user)):
    """Mark as paid_back all open shared-expense debts between current user and other_id."""
    exps = await db.shared_expenses.find(
        {
            **visible_shared_query(user["id"]),
            "status": {"$ne": "finalized"},
        },
        {"_id": 0},
    ).to_list(1000)
    exps = [
        expense for expense in exps
        if user["id"] in {
            participant_reference(item) for item in expense.get("participants", [])
        }
        and other_id in {
            participant_reference(item) for item in expense.get("participants", [])
        }
    ]
    touched = 0
    for e in exps:
        payer = e["payer_id"]
        debtor_id = None
        if payer == other_id:
            debtor_id = user["id"]
        elif payer == user["id"]:
            debtor_id = other_id
        if debtor_id:
            _, changed = await confirm_shared_participant(e, debtor_id)
        else:
            changed = False
        if changed:
            touched += 1
    other = await db.users.find_one({"id": other_id}, {"_id": 0})
    if other and touched:
        await push_notification(
            other_id, "settlement_paid", "Acertos quitados",
            f"{user['name']} marcou todas as dívidas pendentes entre vocês como pagas.",
            "/acertos", {},
        )
    return {"ok": True, "expenses_updated": touched}


@api.post("/settlements/nudge/{debtor_id}")
async def nudge_debtor(debtor_id: str, user=Depends(get_current_user)):
    """Send a reminder notification to a debtor."""
    debtor = await db.users.find_one({"id": debtor_id}, {"_id": 0})
    if not debtor:
        raise HTTPException(400, "Pessoas externas não recebem notificações")
    exps = await db.shared_expenses.find(
        {
            "participant_ids": {"$all": [user["id"], debtor_id]},
            "payer_id": user["id"],
            "status": {"$ne": "finalized"},
        },
        {"_id": 0},
    ).to_list(500)
    total = 0.0
    base_currency = normalize_currency(user.get("currency"))
    for e in exps:
        for p in e["participants"]:
            if participant_reference(p) == debtor_id and not p.get("paid_back"):
                total += amount_in_currency({**e, "amount": p["owed"]}, base_currency)
    if total <= 0:
        raise HTTPException(400, "Sem dívida pendente")
    await push_notification(
        debtor_id, "nudge", "Lembrete de pagamento",
        f"{user['name']} está lembrando que você deve {fmt_eur(total, user.get('currency', 'EUR'))} em despesas compartilhadas.",
        "/acertos", {"from": user["id"]},
    )
    return {"ok": True, "amount": round(total, 2)}


@api.get("/settlements/history")
async def settlement_history(
    user=Depends(get_current_user),
    search: Optional[str] = Query(None, max_length=120),
    specific_date: Optional[str] = None,
    month: Optional[str] = None,
    year: Optional[int] = Query(None, ge=1900, le=2200),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    currency: Optional[str] = None,
    sort: Literal["recent", "oldest", "amount_desc", "amount_asc"] = "recent",
    limit: int = Query(1000, ge=1, le=5000),
):
    def validate_date(value: Optional[str], label: str) -> Optional[str]:
        if not value:
            return None
        try:
            return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
        except ValueError:
            raise HTTPException(400, f"{label} inválida")

    specific = validate_date(specific_date, "Data")
    start = validate_date(start_date, "Data inicial")
    end = validate_date(end_date, "Data final")
    if month:
        try:
            datetime.strptime(month, "%Y-%m")
        except ValueError:
            raise HTTPException(400, "Mês inválido")
    if start and end and start > end:
        raise HTTPException(400, "A data inicial não pode ser posterior à data final")

    owned_expenses = await db.shared_expenses.find(
        {"creator_id": user["id"]}, {"_id": 0, "id": 1}
    ).to_list(5000)
    owned_expense_ids = [item["id"] for item in owned_expenses]
    history_visibility = [
        {"debtor_id": user["id"]},
        {"creditor_id": user["id"]},
    ]
    if owned_expense_ids:
        history_visibility.append({"expense_id": {"$in": owned_expense_ids}})
    items = await db.settlement_history.find(
        {"$or": history_visibility}, {"_id": 0},
    ).to_list(5000)
    # Older versions allowed reopening a confirmation, which could create duplicate
    # history rows for the same debt. Keep the most recent record per participant.
    unique_items = {}
    for item in items:
        key = (item.get("expense_id"), item.get("debtor_id"))
        previous = unique_items.get(key)
        if not previous or (item.get("paid_at") or "") > (previous.get("paid_at") or ""):
            unique_items[key] = item
    items = list(unique_items.values())
    uids = set()
    for it in items:
        uids.update([it["debtor_id"], it["creditor_id"]])
    users = await db.users.find({"id": {"$in": list(uids)}}, {"_id": 0, "password_hash": 0}).to_list(200)
    umap = {u["id"]: public_user(u) for u in users}

    expense_ids = list({item.get("expense_id") for item in items if item.get("expense_id")})
    expenses = await db.shared_expenses.find(
        {"id": {"$in": expense_ids}},
        {
            "_id": 0,
            "id": 1,
            "title": 1,
            "date": 1,
            "category": 1,
            "notes": 1,
            "currency": 1,
            "status": 1,
            "completed_at": 1,
            "creator_id": 1,
            "payer_id": 1,
            "participants": 1,
        },
    ).to_list(5000)
    expense_map = {expense["id"]: expense for expense in expenses}
    party_map = await shared_party_map(expenses, user.get("language", "pt"))

    for it in items:
        expense = expense_map.get(it.get("expense_id"), {})
        it.setdefault("expense_title", expense.get("title", ""))
        it.setdefault("expense_date", expense.get("date"))
        it.setdefault("category", expense.get("category") or "")
        it.setdefault("notes", expense.get("notes") or "")
        it.setdefault("currency", expense.get("currency", "EUR"))
        it.setdefault("expense_status", expense.get("status"))
        it.setdefault("expense_completed_at", expense.get("completed_at"))
        it["debtor"] = party_map.get(it["debtor_id"]) or umap.get(it["debtor_id"]) or deleted_user_summary(
            it["debtor_id"], user.get("language", "pt"))
        it["creditor"] = party_map.get(it["creditor_id"]) or umap.get(it["creditor_id"]) or deleted_user_summary(
            it["creditor_id"], user.get("language", "pt"))

    def matches(item: dict) -> bool:
        paid_date = str(item.get("paid_at") or "")[:10]
        if specific and paid_date != specific:
            return False
        if month and not paid_date.startswith(f"{month}-"):
            return False
        if year and not paid_date.startswith(f"{year:04d}-"):
            return False
        if start and paid_date < start:
            return False
        if end and paid_date > end:
            return False
        if currency and normalize_currency(
            item.get("currency"), user.get("currency", "EUR")
        ) != normalize_currency(currency):
            return False
        if search:
            needle = normalized_search_text(search)
            haystack = " ".join(
                normalized_search_text(value)
                for value in (
                    item.get("debtor", {}).get("name"),
                    item.get("creditor", {}).get("name"),
                    item.get("expense_title"),
                    item.get("category"),
                    item.get("notes"),
                )
            )
            if needle not in haystack:
                return False
        return True

    filtered = [item for item in items if matches(item)]
    if sort == "oldest":
        filtered.sort(key=lambda item: item.get("paid_at") or "")
    elif sort == "amount_desc":
        filtered.sort(key=lambda item: float(item.get("amount") or 0), reverse=True)
    elif sort == "amount_asc":
        filtered.sort(key=lambda item: float(item.get("amount") or 0))
    else:
        filtered.sort(key=lambda item: item.get("paid_at") or "", reverse=True)
    return filtered[:limit]


@api.get("/settlements")
async def list_settlements(user=Depends(get_current_user)):
    """Compute simplified who-owes-whom from open shared expenses involving the user.
    Uses a greedy min-cash-flow algorithm: nets each user's balance then matches
    biggest creditor to biggest debtor iteratively."""
    exps = await db.shared_expenses.find(
        {
            **visible_shared_query(user["id"]),
            "status": {"$ne": "finalized"},
        },
        {"_id": 0},
    ).to_list(1000)
    user_ids = set()
    raw_rows = []
    # Net balance per user (across ALL pending shared expenses the user sees)
    net = defaultdict(float)
    base_currency = normalize_currency(user.get("currency"))
    for e in exps:
        payer = e["payer_id"]
        for p in e["participants"]:
            participant_id = participant_reference(p)
            if participant_id == payer or p.get("paid_back"):
                continue
            owed = amount_in_currency({**e, "amount": p["owed"]}, base_currency)
            net[payer] += owed
            net[participant_id] -= owed
            user_ids.update([payer, participant_id])
            # keep raw row for "lançamentos pendentes" table
            if user["id"] in (participant_id, payer) or e.get("creator_id") == user["id"]:
                raw_rows.append({
                    "expense_id": e["id"], "title": e["title"],
                    "debtor_id": participant_id, "creditor_id": payer,
                    "amount": round(owed, 2), "date": e["date"],
                    "currency": base_currency,
                    "managed_by_user": e.get("creator_id") == user["id"],
                })
    # Simplification: greedy match
    creditors = sorted(
        [(uid, round(v, 2)) for uid, v in net.items() if v > 0.005],
        key=lambda x: -x[1],
    )
    debtors = sorted(
        [(uid, round(-v, 2)) for uid, v in net.items() if v < -0.005],
        key=lambda x: -x[1],
    )
    transfers = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        d_id, d_amt = debtors[i]
        c_id, c_amt = creditors[j]
        amount = round(min(d_amt, c_amt), 2)
        if user["id"] in (d_id, c_id) or any(
            expense.get("creator_id") == user["id"]
            for expense in exps
        ):
            transfers.append({
                "debtor_id": d_id, "creditor_id": c_id, "amount": amount,
            })
        d_amt = round(d_amt - amount, 2)
        c_amt = round(c_amt - amount, 2)
        debtors[i] = (d_id, d_amt)
        creditors[j] = (c_id, c_amt)
        if d_amt <= 0.005:
            i += 1
        if c_amt <= 0.005:
            j += 1

    party_map = await shared_party_map(exps, user.get("language", "pt"))
    umap = party_map
    for r in raw_rows:
        r["debtor"] = umap.get(r["debtor_id"])
        r["creditor"] = umap.get(r["creditor_id"])
    for t in transfers:
        t["debtor"] = umap.get(t["debtor_id"])
        t["creditor"] = umap.get(t["creditor_id"])

    # Summary per counterpart from the user's perspective
    summary = []
    for uid, val in net.items():
        if uid == user["id"]:
            continue
        # how much does THIS user net with `uid`?
        # net[user] - net[uid] cannot be used directly; recompute from raw
        v = 0.0
        for r in raw_rows:
            if r["creditor_id"] == user["id"] and r["debtor_id"] == uid:
                v += r["amount"]
            elif r["debtor_id"] == user["id"] and r["creditor_id"] == uid:
                v -= r["amount"]
        if abs(v) > 0.005:
            summary.append({"user": umap.get(uid), "net": round(v, 2)})
    return {"rows": raw_rows, "summary": summary, "transfers": transfers}


# ---------- Dashboard / Reports ----------
@api.get("/dashboard")
async def dashboard(user=Depends(get_current_user), year: Optional[int] = None, month: Optional[int] = None):
    now = datetime.now(timezone.utc)
    y = year or now.year
    m = month or now.month
    await materialize_recurrences(user["id"], month_end_date(y, m))
    start, end = month_range(y, m)

    txs = await db.transactions.find(
        {"user_id": user["id"], "date": {"$gte": start[:10], "$lt": end[:10]},
         "status": {"$ne": "cancelled"}},
        {"_id": 0},
    ).to_list(5000)

    base_currency = normalize_currency(user.get("currency"))
    currencies = await account_currency_map(user)

    def converted(doc: dict, amount_key: str = "amount") -> float:
        enriched = dict(doc)
        if not enriched.get("currency"):
            enriched["currency"] = currencies.get(enriched.get("account_id"), base_currency)
        return amount_in_currency(enriched, base_currency, amount_key)

    income = sum(converted(t) for t in txs if t["type"] == "income")
    expense = sum(converted(t) for t in txs if t["type"] == "expense")
    pending_payable = sum(converted(t) for t in txs if t["type"] == "expense" and t["status"] == "pending")

    # Installment parcels due in this month -> count as expense (linked)
    inst_month = await db.installments.find(
        {"user_id": user["id"], "due_date": {"$gte": start[:10], "$lt": end[:10]}},
        {"_id": 0},
    ).to_list(1000)
    inst_purchase_map = {}
    if inst_month:
        pids = list({i["purchase_id"] for i in inst_month})
        purchases = await db.installment_purchases.find(
            {"id": {"$in": pids}}, {"_id": 0}).to_list(500)
        inst_purchase_map = {p["id"]: p for p in purchases}

    def converted_installment(item: dict) -> float:
        purchase = inst_purchase_map.get(item.get("purchase_id"), {})
        return converted({**purchase, "amount": item.get("amount", 0)})

    installments_month_total = sum(converted_installment(i) for i in inst_month)
    expense += installments_month_total
    pending_payable += sum(converted_installment(i) for i in inst_month if i["status"] == "pending")

    # Categories breakdown (transactions + installments)
    cats = await db.categories.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)
    cmap = {c["id"]: c for c in cats}
    by_cat = defaultdict(float)
    for t in txs:
        if t["type"] == "expense" and t.get("category_id"):
            by_cat[t["category_id"]] += converted(t)
    if inst_month:
        for i in inst_month:
            cid = inst_purchase_map.get(i["purchase_id"], {}).get("category_id")
            if cid:
                by_cat[cid] += converted_installment(i)
    cat_breakdown = [
        {"category": cmap.get(cid, {}).get("name", "Outros"),
         "color": cmap.get(cid, {}).get("color", "#6B7068"),
         "amount": round(v, 2)}
        for cid, v in sorted(by_cat.items(), key=lambda x: -x[1])
    ]

    # Receivables pending — scoped to this month (and overdue), not future months
    rec_pending = await db.receivables.find(
        {"user_id": user["id"], "status": "pending", "due_date": {"$lt": end[:10]}}, {"_id": 0}
    ).to_list(200)
    receivable_total = sum(converted(r) for r in rec_pending)

    # Shared expenses: include what others owe me and what I owe others
    shared_exps = await db.shared_expenses.find(
        {"participant_ids": user["id"]}, {"_id": 0}
    ).to_list(1000)
    shared_receivable = 0.0
    shared_payable = 0.0
    for se in shared_exps:
        payer = se["payer_id"]
        for p in se["participants"]:
            participant_id = participant_reference(p)
            if p.get("paid_back"):
                continue
            if participant_id == payer:
                continue
            if payer == user["id"]:
                # I paid -> they owe me
                shared_receivable += converted({**se, "amount": p["owed"]})
            elif participant_id == user["id"]:
                # I owe the payer
                shared_payable += converted({**se, "amount": p["owed"]})
    receivable_total += shared_receivable
    pending_payable += shared_payable

    # Future installments
    inst_future = await db.installments.find(
        {"user_id": user["id"], "status": "pending", "due_date": {"$gte": now.date().isoformat()}},
        {"_id": 0},
    ).to_list(500)
    future_purchase_map = {}
    if inst_future:
        future_pids = list({i["purchase_id"] for i in inst_future})
        future_purchases = await db.installment_purchases.find(
            {"id": {"$in": future_pids}}, {"_id": 0}).to_list(500)
        future_purchase_map = {p["id"]: p for p in future_purchases}
    future_installments_total = sum(
        converted({**future_purchase_map.get(i.get("purchase_id"), {}), "amount": i.get("amount", 0)})
        for i in inst_future
    )

    # Last 6 months evolution
    evolution = []
    for i in range(5, -1, -1):
        mm = m - i
        yy = y
        while mm <= 0:
            mm += 12
            yy -= 1
        s, e = month_range(yy, mm)
        mt = await db.transactions.find(
            {"user_id": user["id"], "date": {"$gte": s[:10], "$lt": e[:10]},
             "status": {"$ne": "cancelled"}},
            {"_id": 0},
        ).to_list(5000)
        inc = sum(converted(t) for t in mt if t["type"] == "income")
        exp = sum(converted(t) for t in mt if t["type"] == "expense")
        evolution.append({
            "month": f"{yy}-{mm:02d}",
            "income": round(inc, 2),
            "expense": round(exp, 2),
            "balance": round(inc - exp, 2),
        })

    # Budget 50/20/10/10/10
    budget = {
        "income": round(income, 2),
        "rules": [
            {"label": "Necessidades", "percent": 50, "amount": round(income * 0.5, 2)},
            {"label": "Reserva / Investimentos", "percent": 20, "amount": round(income * 0.2, 2)},
            {"label": "Lazer", "percent": 10, "amount": round(income * 0.1, 2)},
            {"label": "Educação", "percent": 10, "amount": round(income * 0.1, 2)},
            {"label": "Outros objetivos", "percent": 10, "amount": round(income * 0.1, 2)},
        ],
    }

    # Fixed (recurring) monthly average — normalizes weekly/yearly to monthly
    _FREQ_FACTOR = {"weekly": 52 / 12, "monthly": 1.0, "quarterly": 1 / 3, "semiannual": 1 / 6, "yearly": 1 / 12}
    recs = await db.recurrences.find(
        {"user_id": user["id"], "active": True}, {"_id": 0}).to_list(500)
    fixed_monthly_expense = round(sum(
        converted(r) * _FREQ_FACTOR.get(r["frequency"], 1.0)
        for r in recs if r["type"] == "expense"), 2)
    fixed_monthly_income = round(sum(
        converted(r) * _FREQ_FACTOR.get(r["frequency"], 1.0)
        for r in recs if r["type"] == "income"), 2)

    return {
        "period": {"year": y, "month": m},
        "base_currency": base_currency,
        "income": round(income, 2),
        "expense": round(expense, 2),
        "balance": round(income - expense, 2),
        "pending_payable": round(pending_payable, 2),
        "receivable_total": round(receivable_total, 2),
        "shared_receivable": round(shared_receivable, 2),
        "shared_payable": round(shared_payable, 2),
        "future_installments_total": round(future_installments_total, 2),
        "installments_month_total": round(installments_month_total, 2),
        "fixed_monthly_expense": fixed_monthly_expense,
        "fixed_monthly_income": fixed_monthly_income,
        "category_breakdown": cat_breakdown,
        "evolution": evolution,
        "budget": budget,
    }


@api.get("/reports/annual")
async def annual_report(year: int, user=Depends(get_current_user)):
    base_currency = normalize_currency(user.get("currency"))
    currencies = await account_currency_map(user)

    def converted(doc: dict) -> float:
        enriched = dict(doc)
        if not enriched.get("currency"):
            enriched["currency"] = currencies.get(enriched.get("account_id"), base_currency)
        return amount_in_currency(enriched, base_currency)

    async def year_months(yr):
        out = []
        for m in range(1, 13):
            s, e = month_range(yr, m)
            txs = await db.transactions.find(
                {"user_id": user["id"], "date": {"$gte": s[:10], "$lt": e[:10]},
                 "status": {"$ne": "cancelled"}},
                {"_id": 0},
            ).to_list(5000)
            inc = sum(converted(t) for t in txs if t["type"] == "income")
            exp = sum(converted(t) for t in txs if t["type"] == "expense")
            # Include installment parcels due in this month as expense (matches Dashboard)
            inst = await db.installments.find(
                {"user_id": user["id"], "due_date": {"$gte": s[:10], "$lt": e[:10]}},
                {"_id": 0, "amount": 1, "purchase_id": 1},
            ).to_list(2000)
            if inst:
                pids = list({i["purchase_id"] for i in inst})
                purchases = await db.installment_purchases.find(
                    {"id": {"$in": pids}}, {"_id": 0}).to_list(500)
                pmap = {p["id"]: p for p in purchases}
                exp += sum(converted({**pmap.get(i["purchase_id"], {}), "amount": i["amount"]}) for i in inst)
            out.append({"month": m, "income": round(inc, 2),
                        "expense": round(exp, 2), "balance": round(inc - exp, 2)})
        return out

    months = await year_months(year)
    prev_months = await year_months(year - 1)
    tot = lambda arr, k: round(sum(x[k] for x in arr), 2)
    return {
        "year": year,
        "base_currency": base_currency,
        "months": months,
        "prev_year": year - 1,
        "prev_months": prev_months,
        "totals": {"income": tot(months, "income"), "expense": tot(months, "expense"),
                   "balance": tot(months, "balance")},
        "prev_totals": {"income": tot(prev_months, "income"), "expense": tot(prev_months, "expense"),
                        "balance": tot(prev_months, "balance")},
    }


def _change_percent(current: float, previous: float) -> Optional[float]:
    if previous == 0:
        return None if current == 0 else 100.0
    return round(((current - previous) / abs(previous)) * 100, 1)


def build_monthly_report(
    year: int,
    month: int,
    items: List[dict],
    categories: List[dict],
    base_currency: str,
) -> dict:
    """Build one canonical monthly report used by the UI and exports."""
    base = normalize_currency(base_currency)
    category_map = {c["id"]: c for c in categories}
    detailed = []
    for item in items:
        if item.get("type") not in ("income", "expense"):
            continue
        row = dict(item)
        row["currency"] = normalize_currency(row.get("currency"), base)
        row["base_amount"] = round(amount_in_currency(row, base), 2)
        category = category_map.get(row.get("category_id"), {})
        row["category"] = category.get("name", "Sem categoria")
        row["category_color"] = category.get("color", "#6B7068")
        row["source"] = row.get("source") or (
            "recurrence" if row.get("recurrence_id") else "manual")
        row["is_fixed"] = row["source"] == "recurrence"
        row["is_installment"] = row["source"] == "installment"
        detailed.append(row)

    detailed.sort(key=lambda row: (row.get("date", ""), row.get("created_at", "")), reverse=True)
    entries = [row for row in detailed if row["type"] == "income"]
    expenses = [row for row in detailed if row["type"] == "expense"]

    def total(rows, status=None):
        selected = rows if status is None else [row for row in rows if row.get("status") == status]
        return round(sum(row["base_amount"] for row in selected), 2)

    income_total = total(entries)
    expense_total = total(expenses)
    paid_income = total(entries, "paid")
    paid_expense = total(expenses, "paid")
    pending_income = total(entries, "pending")
    pending_expense = total(expenses, "pending")
    balance = round(income_total - expense_total, 2)
    realized_balance = round(paid_income - paid_expense, 2)

    fixed_expense = round(sum(row["base_amount"] for row in expenses if row["is_fixed"]), 2)
    installment_expense = round(sum(row["base_amount"] for row in expenses if row["is_installment"]), 2)
    variable_expense = round(
        sum(row["base_amount"] for row in expenses if not row["is_fixed"] and not row["is_installment"]), 2)

    category_totals = defaultdict(float)
    category_colors = {}
    for row in expenses:
        category_totals[row["category"]] += row["base_amount"]
        category_colors[row["category"]] = row["category_color"]
    category_breakdown = [
        {
            "category": name,
            "amount": round(amount, 2),
            "percent": round((amount / expense_total) * 100, 1) if expense_total else 0,
            "color": category_colors[name],
        }
        for name, amount in sorted(category_totals.items(), key=lambda value: -value[1])
    ]

    largest_expense = max(expenses, key=lambda row: row["base_amount"], default=None)
    top_category = category_breakdown[0] if category_breakdown else None
    return {
        "period": {"year": year, "month": month},
        "base_currency": base,
        "summary": {
            "income": income_total,
            "expense": expense_total,
            "balance": balance,
            "balance_status": "positive" if balance > 0 else "negative" if balance < 0 else "neutral",
            "paid_income": paid_income,
            "paid_expense": paid_expense,
            "pending_income": pending_income,
            "pending_expense": pending_expense,
            "realized_balance": realized_balance,
            "savings_rate": round((balance / income_total) * 100, 1) if income_total else None,
            "transaction_count": len(detailed),
        },
        "expense_profile": {
            "fixed": fixed_expense,
            "variable": variable_expense,
            "installments": installment_expense,
        },
        "largest_expense": largest_expense,
        "top_category": top_category,
        "category_breakdown": category_breakdown,
        "entries": entries,
        "expenses": expenses,
    }


async def _monthly_report_items(user: dict, year: int, month: int) -> List[dict]:
    await materialize_recurrences(user["id"], month_end_date(year, month))
    start, end = month_range(year, month)
    rows = await db.transactions.find(
        {
            "user_id": user["id"],
            "date": {"$gte": start[:10], "$lt": end[:10]},
            "status": {"$ne": "cancelled"},
            "type": {"$in": ["income", "expense"]},
        },
        {"_id": 0},
    ).to_list(10000)
    for row in rows:
        row["source"] = "recurrence" if row.get("recurrence_id") else "manual"

    installments = await db.installments.find(
        {
            "user_id": user["id"],
            "due_date": {"$gte": start[:10], "$lt": end[:10]},
            "status": {"$ne": "cancelled"},
        },
        {"_id": 0},
    ).to_list(5000)
    if installments:
        purchase_ids = list({item["purchase_id"] for item in installments})
        purchases = await db.installment_purchases.find(
            {"id": {"$in": purchase_ids}}, {"_id": 0}).to_list(2000)
        purchase_map = {purchase["id"]: purchase for purchase in purchases}
        for item in installments:
            purchase = purchase_map.get(item["purchase_id"], {})
            rows.append({
                "id": item["id"],
                "type": "expense",
                "date": item["due_date"],
                "amount": item.get("amount", 0),
                "status": item.get("status", "pending"),
                "description": purchase.get("description", "Parcela"),
                "category_id": purchase.get("category_id"),
                "account_id": purchase.get("account_id"),
                "payment_method": purchase.get("payment_method"),
                "currency": purchase.get("currency"),
                "exchange_rates": purchase.get("exchange_rates"),
                "base_currency_at_creation": purchase.get("base_currency_at_creation"),
                "exchange_rate_to_base": purchase.get("exchange_rate_to_base"),
                "rate_date": purchase.get("rate_date"),
                "source": "installment",
                "purchase_id": item["purchase_id"],
                "installment_number": item.get("number"),
                "installment_total": item.get("total"),
            })

    currencies = await account_currency_map(user)
    base = normalize_currency(user.get("currency"))
    for row in rows:
        row["currency"] = normalize_currency(
            row.get("currency"), currencies.get(row.get("account_id"), base))
    return rows


@api.get("/reports/monthly")
async def monthly_report(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    user=Depends(get_current_user),
):
    categories = await db.categories.find(
        {"user_id": user["id"]}, {"_id": 0}).to_list(500)
    current_items = await _monthly_report_items(user, year, month)
    current = build_monthly_report(
        year, month, current_items, categories, user.get("currency", "EUR"))

    previous_month = month - 1
    previous_year = year
    if previous_month == 0:
        previous_month = 12
        previous_year -= 1
    previous_items = await _monthly_report_items(user, previous_year, previous_month)
    previous = build_monthly_report(
        previous_year, previous_month, previous_items, categories, user.get("currency", "EUR"))
    current_summary = current["summary"]
    previous_summary = previous["summary"]
    current["previous_month"] = {
        "period": previous["period"],
        "summary": previous_summary,
    }
    current["comparison"] = {
        key: {
            "difference": round(current_summary[key] - previous_summary[key], 2),
            "percent": _change_percent(current_summary[key], previous_summary[key]),
        }
        for key in ("income", "expense", "balance")
    }
    return current


def report_period_bounds(filters: ReportFiltersIn) -> tuple[Optional[str], Optional[str]]:
    def valid_day(value: Optional[str], label: str) -> Optional[str]:
        if not value:
            return None
        try:
            return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
        except ValueError:
            raise HTTPException(400, f"{label} inválida")

    if filters.period == "date":
        day = valid_day(filters.specific_date, "Data")
        if not day:
            raise HTTPException(400, "Informe a data")
        return day, day
    if filters.period == "month":
        if not filters.month:
            raise HTTPException(400, "Informe o mês")
        try:
            parsed = datetime.strptime(filters.month, "%Y-%m")
        except ValueError:
            raise HTTPException(400, "Mês inválido")
        start, end = month_range(parsed.year, parsed.month)
        return start[:10], (datetime.fromisoformat(end[:10]) - timedelta(days=1)).date().isoformat()
    if filters.period == "year":
        if not filters.year:
            raise HTTPException(400, "Informe o ano")
        return f"{filters.year:04d}-01-01", f"{filters.year:04d}-12-31"
    if filters.period == "range":
        start = valid_day(filters.start_date, "Data inicial")
        end = valid_day(filters.end_date, "Data final")
        if not start or not end:
            raise HTTPException(400, "Informe as datas inicial e final")
        if start > end:
            raise HTTPException(400, "A data inicial não pode ser posterior à data final")
        return start, end
    return None, None


def apply_custom_report_filters(
    rows: List[dict],
    filters: ReportFiltersIn,
    category_names: dict[str, str],
) -> List[dict]:
    start, end = report_period_bounds(filters)
    needle = normalized_search_text(filters.description)
    selected_categories = {
        normalized_search_text(category_names.get(category_id, category_id.removeprefix("shared:")))
        for category_id in filters.category_ids
    }
    selected_people = set(filters.participant_ids)
    selected_accounts = set(filters.account_ids)
    selected_statuses = set(filters.statuses)
    selected_types = set(filters.types)
    selected_currencies = {
        normalize_currency(currency) for currency in filters.currencies
    }

    def matches(row: dict) -> bool:
        row_date = str(row.get("date") or "")[:10]
        if start and row_date < start:
            return False
        if end and row_date > end:
            return False
        if selected_types and row.get("type") not in selected_types:
            return False
        if selected_statuses and row.get("status") not in selected_statuses:
            return False
        if selected_people and not selected_people.intersection(row.get("participant_ids") or []):
            return False
        if selected_accounts and not selected_accounts.intersection(row.get("account_ids") or []):
            return False
        if selected_currencies:
            row_currencies = {
                normalize_currency(row.get("currency")),
            }
            if row.get("target_currency"):
                row_currencies.add(normalize_currency(row["target_currency"]))
            if not selected_currencies.intersection(row_currencies):
                return False
        if selected_categories:
            row_category = normalized_search_text(row.get("category"))
            if row_category not in selected_categories:
                return False
        if needle:
            haystack = normalized_search_text(" ".join(str(value or "") for value in (
                row.get("description"),
                row.get("notes"),
                row.get("category"),
                row.get("account"),
                " ".join(row.get("participant_names") or []),
            )))
            if needle not in haystack:
                return False
        return True

    return [row for row in rows if matches(row)]


def summarize_custom_report(rows: List[dict]) -> dict:
    totals = defaultdict(float)
    for row in rows:
        direction = row.get("direction", "other")
        if (
            direction in ("receivable", "payable")
            and row.get("status") not in ("pending", "overdue")
        ):
            continue
        totals[direction] += float(row.get("base_amount") or 0)
    return {
        "income": round(totals["income"], 2),
        "expense": round(totals["expense"], 2),
        "transfers": round(totals["transfer"], 2),
        "shared_receivable": round(totals["receivable"], 2),
        "shared_payable": round(totals["payable"], 2),
        "settled": round(totals["settled"], 2),
        "balance": round(
            totals["income"] - totals["expense"]
            + totals["receivable"] - totals["payable"],
            2,
        ),
        "count": len(rows),
    }


def summarize_report_participant(
    rows: List[dict],
    participant_id: Optional[str],
) -> Optional[dict]:
    if not participant_id:
        return None
    totals = defaultdict(float)
    participant_name = ""
    for row in rows:
        parties = row.get("participants") or []
        party = next(
            (item for item in parties if item.get("id") == participant_id),
            None,
        )
        if not party:
            continue
        participant_name = participant_name or party.get("name", "")
        amount = float(row.get("base_amount") or 0)
        row_type = row.get("type")
        row_status = row.get("status")
        if row_type == "shared_expense" and row_status in ("pending", "overdue"):
            if party.get("role") == "creditor":
                totals["to_receive"] += amount
            elif party.get("role") == "debtor":
                totals["to_pay"] += amount
        elif row_type == "settlement":
            if party.get("role") == "creditor":
                totals["received"] += amount
            elif party.get("role") == "debtor":
                totals["paid"] += amount
        elif row_type in ("income", "expense"):
            if row_status in ("pending", "overdue"):
                if party.get("role") == "creditor":
                    totals["to_receive"] += amount
                elif party.get("role") == "debtor":
                    totals["to_pay"] += amount
            elif row_status in ("paid", "completed"):
                if party.get("role") == "creditor":
                    totals["received"] += amount
                elif party.get("role") == "debtor":
                    totals["paid"] += amount
    return {
        "id": participant_id,
        "name": participant_name,
        "to_receive": round(totals["to_receive"], 2),
        "to_pay": round(totals["to_pay"], 2),
        "received": round(totals["received"], 2),
        "paid": round(totals["paid"], 2),
        "balance": round(totals["to_receive"] - totals["to_pay"], 2),
    }


async def custom_report_options(user: dict) -> dict:
    categories, accounts, people, shared = await asyncio.gather(
        db.categories.find(
            {"user_id": user["id"]}, {"_id": 0}
        ).sort("name", 1).to_list(1000),
        db.accounts.find(
            {"user_id": user["id"]}, {"_id": 0}
        ).sort("name", 1).to_list(1000),
        db.people.find(
            {"owner_user_id": user["id"]}, {"_id": 0}
        ).sort("name", 1).to_list(1000),
        db.shared_expenses.find(
            visible_shared_query(user["id"]), {"_id": 0}
        ).to_list(5000),
    )
    category_names = {
        normalized_search_text(item.get("name")) for item in categories
    }
    for expense in shared:
        name = (expense.get("category") or "").strip()
        key = normalized_search_text(name)
        if name and key not in category_names:
            categories.append({
                "id": f"shared:{key}",
                "name": name,
                "shared_only": True,
            })
            category_names.add(key)

    party_map = await shared_party_map(shared, user.get("language", "pt"))
    participant_map = {
        user["id"]: {
            **public_user(user),
            "self": True,
        }
    }
    participant_map.update({
        item["id"]: private_person_summary(item)
        for item in people
    })
    for party_id, party in party_map.items():
        participant_map.setdefault(party_id, party)
    participants = sorted(
        participant_map.values(),
        key=lambda item: normalized_search_text(item.get("name")),
    )
    return {
        "categories": categories,
        "accounts": accounts,
        "participants": participants,
        "currencies": list(SUPPORTED_CURRENCIES),
    }


@api.get("/reports/filter-options")
async def report_filter_options(user=Depends(get_current_user)):
    return await custom_report_options(user)


@api.post("/reports/filtered")
async def filtered_report(
    filters: ReportFiltersIn,
    user=Depends(get_current_user),
):
    base_currency = normalize_currency(user.get("currency"))
    categories, accounts, people, transactions, installments, purchases, shared = await asyncio.gather(
        db.categories.find({"user_id": user["id"]}, {"_id": 0}).to_list(1000),
        db.accounts.find({"user_id": user["id"]}, {"_id": 0}).to_list(1000),
        db.people.find({"owner_user_id": user["id"]}, {"_id": 0}).to_list(1000),
        db.transactions.find({"user_id": user["id"]}, {"_id": 0}).to_list(20000),
        db.installments.find({"user_id": user["id"]}, {"_id": 0}).to_list(10000),
        db.installment_purchases.find({"user_id": user["id"]}, {"_id": 0}).to_list(5000),
        db.shared_expenses.find(
            visible_shared_query(user["id"]), {"_id": 0}
        ).to_list(10000),
    )
    category_map = {item["id"]: item for item in categories}
    account_map = {item["id"]: item for item in accounts}
    purchase_map = {item["id"]: item for item in purchases}
    party_map = await shared_party_map(shared, user.get("language", "pt"))
    party_map[user["id"]] = public_user(user)
    party_map.update({
        item["id"]: private_person_summary(item)
        for item in people
    })
    today = datetime.now(timezone.utc).date().isoformat()
    rows = []

    def converted(item: dict) -> float:
        return round(amount_in_currency(item, base_currency), 2)

    def normalized_status(status: str, row_date: str) -> str:
        if status == "pending" and row_date < today:
            return "overdue"
        if status in ("received", "finalized"):
            return "completed"
        return status

    for item in transactions:
        item_type = item.get("type")
        if (
            item_type not in ("income", "expense", "transfer")
            or item.get("status") == "cancelled"
        ):
            continue
        account_ids = [
            value for value in (
                item.get("account_id"),
                item.get("from_account_id"),
                item.get("to_account_id"),
            ) if value
        ]
        account_labels = [
            account_map.get(account_id, {}).get("name", "")
            for account_id in account_ids
        ]
        person_id = item.get("person_id")
        person = party_map.get(person_id, {"name": "Pessoa"}) if person_id else None
        person_role = "debtor" if item_type == "income" else "creditor"
        rows.append({
            "id": item["id"],
            "type": item_type,
            "date": item.get("date"),
            "description": item.get("description") or "Sem descrição",
            "notes": item.get("notes") or "",
            "category": category_map.get(item.get("category_id"), {}).get("name", "Sem categoria"),
            "category_id": item.get("category_id"),
            "status": normalized_status(item.get("status", "paid"), item.get("date", "")),
            "amount": item.get("amount", 0),
            "currency": item.get("currency", base_currency),
            "target_currency": item.get("target_currency"),
            "base_amount": converted(item),
            "direction": item_type if item_type != "transfer" else "transfer",
            "account": " → ".join(filter(None, account_labels)),
            "account_ids": account_ids,
            "participants": [{
                "id": person_id,
                "name": person.get("name", "Pessoa"),
                "role": person_role,
                "external": person.get("external", False),
            }] if person_id else [],
            "participant_ids": [person_id] if person_id else [],
            "participant_names": [person.get("name", "Pessoa")] if person_id else [],
            "source": "recurrence" if item.get("recurrence_id") else "manual",
        })

    for item in installments:
        purchase = purchase_map.get(item.get("purchase_id"), {})
        account_id = purchase.get("account_id")
        merged = {**purchase, "amount": item.get("amount", 0)}
        rows.append({
            "id": item["id"],
            "type": "expense",
            "date": item.get("due_date"),
            "description": f"{purchase.get('description', 'Parcela')} ({item.get('number')}/{item.get('total')})",
            "notes": "",
            "category": category_map.get(purchase.get("category_id"), {}).get("name", "Sem categoria"),
            "category_id": purchase.get("category_id"),
            "status": normalized_status(item.get("status", "pending"), item.get("due_date", "")),
            "amount": item.get("amount", 0),
            "currency": purchase.get("currency", base_currency),
            "base_amount": converted(merged),
            "direction": "expense",
            "account": account_map.get(account_id, {}).get("name", ""),
            "account_ids": [account_id] if account_id else [],
            "participants": [],
            "participant_ids": [],
            "participant_names": [],
            "source": "installment",
        })

    for expense in shared:
        payer_id = expense.get("payer_id")
        payer = party_map.get(payer_id, {"id": payer_id, "name": "Pessoa"})
        for participant in expense.get("participants", []):
            debtor_id = participant_reference(participant)
            if not debtor_id or debtor_id == payer_id:
                continue
            debtor = party_map.get(debtor_id, {"id": debtor_id, "name": "Pessoa"})
            if payer_id == user["id"]:
                direction = "receivable"
            elif debtor_id == user["id"]:
                direction = "payable"
            else:
                direction = "other"
            status = "completed" if participant.get("paid_back") else normalized_status(
                "pending", expense.get("date", "")
            )
            amount_doc = {**expense, "amount": participant.get("owed", 0)}
            rows.append({
                "id": f"{expense['id']}:{debtor_id}",
                "expense_id": expense["id"],
                "type": "shared_expense",
                "date": expense.get("date"),
                "description": expense.get("title") or "Despesa compartilhada",
                "notes": expense.get("notes") or "",
                "category": expense.get("category") or "Sem categoria",
                "category_id": None,
                "status": status,
                "amount": participant.get("owed", 0),
                "currency": expense.get("currency", base_currency),
                "base_amount": converted(amount_doc),
                "direction": direction,
                "account": "",
                "account_ids": [],
                "participants": [
                    {"id": payer_id, "name": payer.get("name"), "role": "creditor", "external": payer.get("external", False)},
                    {"id": debtor_id, "name": debtor.get("name"), "role": "debtor", "external": debtor.get("external", False)},
                ],
                "participant_ids": [payer_id, debtor_id],
                "participant_names": [payer.get("name", ""), debtor.get("name", "")],
            })

    shared_ids = [item["id"] for item in shared]
    history = await db.settlement_history.find(
        {"expense_id": {"$in": shared_ids}}, {"_id": 0}
    ).to_list(10000) if shared_ids else []
    shared_map = {item["id"]: item for item in shared}
    for item in history:
        expense = shared_map.get(item.get("expense_id"), {})
        debtor_id = item.get("debtor_id")
        creditor_id = item.get("creditor_id")
        debtor = party_map.get(debtor_id, {"id": debtor_id, "name": "Pessoa"})
        creditor = party_map.get(creditor_id, {"id": creditor_id, "name": "Pessoa"})
        amount_doc = {
            **expense,
            **item,
            "amount": item.get("amount", 0),
            "currency": item.get("currency") or expense.get("currency", base_currency),
        }
        rows.append({
            "id": item.get("id") or f"settlement:{item.get('expense_id')}:{debtor_id}",
            "expense_id": item.get("expense_id"),
            "type": "settlement",
            "date": str(item.get("paid_at") or "")[:10],
            "description": item.get("expense_title") or expense.get("title") or "Acerto",
            "notes": item.get("notes") or expense.get("notes") or "",
            "category": item.get("category") or expense.get("category") or "Sem categoria",
            "category_id": None,
            "status": "completed",
            "amount": item.get("amount", 0),
            "currency": amount_doc["currency"],
            "base_amount": converted(amount_doc),
            "direction": "settled",
            "account": "",
            "account_ids": [],
            "participants": [
                {"id": debtor_id, "name": debtor.get("name"), "role": "debtor", "external": debtor.get("external", False)},
                {"id": creditor_id, "name": creditor.get("name"), "role": "creditor", "external": creditor.get("external", False)},
            ],
            "participant_ids": [debtor_id, creditor_id],
            "participant_names": [debtor.get("name", ""), creditor.get("name", "")],
        })

    category_names = {item["id"]: item["name"] for item in categories}
    for expense in shared:
        name = expense.get("category") or "Sem categoria"
        category_names[f"shared:{normalized_search_text(name)}"] = name
    filtered = apply_custom_report_filters(rows, filters, category_names)
    filtered.sort(key=lambda item: (item.get("date") or "", item.get("id") or ""), reverse=True)
    return {
        "base_currency": base_currency,
        "filters": filters.model_dump(),
        "summary": summarize_custom_report(filtered),
        "participant_summary": summarize_report_participant(
            filtered,
            filters.participant_ids[0]
            if len(filters.participant_ids) == 1 else None,
        ),
        "rows": filtered[:10000],
    }


async def _month_net(user: dict, yy, mm):
    s, e = month_range(yy, mm)
    txs = await db.transactions.find(
        {"user_id": user["id"], "date": {"$gte": s[:10], "$lt": e[:10]},
         "status": {"$ne": "cancelled"}}, {"_id": 0},
    ).to_list(5000)
    base_currency = normalize_currency(user.get("currency"))
    currencies = await account_currency_map(user)
    for tx in txs:
        if not tx.get("currency"):
            tx["currency"] = currencies.get(tx.get("account_id"), base_currency)
    inc = sum(amount_in_currency(t, base_currency) for t in txs if t["type"] == "income")
    exp = sum(amount_in_currency(t, base_currency) for t in txs if t["type"] == "expense")
    return round(inc, 2), round(exp, 2)


@api.get("/reports/projection")
async def projection(months: int = 6, user=Depends(get_current_user)):
    months = max(1, min(months, 12))
    now = datetime.now(timezone.utc)
    all_txs = await db.transactions.find(
        {"user_id": user["id"], "status": {"$ne": "cancelled"}},
        {"_id": 0},
    ).to_list(20000)
    base_currency = normalize_currency(user.get("currency"))
    currencies = await account_currency_map(user)
    for tx in all_txs:
        if not tx.get("currency"):
            tx["currency"] = currencies.get(tx.get("account_id"), base_currency)
    current_balance = round(
        sum(amount_in_currency(t, base_currency) for t in all_txs if t["type"] == "income")
        - sum(amount_in_currency(t, base_currency) for t in all_txs if t["type"] == "expense"), 2)
    nets = []
    for i in range(5, -1, -1):
        mm, yy = now.month - i, now.year
        while mm <= 0:
            mm += 12
            yy -= 1
        inc, exp = await _month_net(user, yy, mm)
        nets.append(inc - exp)
    avg = round(sum(nets) / len(nets), 2) if nets else 0.0
    series = []
    bal = current_balance
    mm, yy = now.month, now.year
    for _ in range(months):
        mm += 1
        if mm > 12:
            mm = 1
            yy += 1
        bal = round(bal + avg, 2)
        series.append({"month": f"{yy}-{mm:02d}", "projected": bal})
    return {"current_balance": current_balance, "avg_monthly_net": avg,
            "base_currency": base_currency, "projection": series}


INSIGHT_PRIORITY = {
    "critical": 0,
    "warning": 1,
    "opportunity": 2,
    "good": 3,
    "info": 4,
}

INSIGHT_PREF_TYPES = (
    "spending",
    "economy",
    "balance",
    "recurring",
    "settlements",
    "anomalies",
)


def default_insight_prefs(values: Optional[dict] = None) -> dict:
    source = values or {}
    return {key: bool(source.get(key, True)) for key in INSIGHT_PREF_TYPES}


def build_crelith_insights(
    *,
    today: date,
    currency: str,
    current_items: List[dict],
    previous_items: List[dict],
    categories: List[dict],
    current_balance: float,
    future_cashflows: List[dict],
    overdue_settlements: int,
    hidden_ids: Optional[set[str]] = None,
    preferences: Optional[dict] = None,
    feedback: Optional[dict] = None,
    comparable_days: Optional[int] = None,
    historical_months: Optional[List[dict]] = None,
    account_trends: Optional[List[dict]] = None,
    wealth_history: Optional[List[dict]] = None,
    goals: Optional[List[dict]] = None,
    recurring_candidates: Optional[List[dict]] = None,
    recurring_burden: Optional[dict] = None,
) -> List[dict]:
    """Build deterministic, auditable insights without external AI services."""
    hidden_ids = hidden_ids or set()
    preferences = default_insight_prefs(preferences)
    feedback = feedback or {}
    period = f"{today.year}-{today.month:02d}"
    category_map = {item["id"]: item.get("name", "Outros") for item in categories}
    insights = []
    had_candidate = False
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    days_remaining = max(days_in_month - today.day + 1, 1)
    previous_period_days = max(comparable_days or today.day, 1)
    historical_months = historical_months or []
    account_trends = account_trends or []
    wealth_history = wealth_history or []
    goals = goals or []
    recurring_candidates = recurring_candidates or []
    recurring_burden = recurring_burden or {}

    def add(
        code: str,
        insight_type: str,
        severity: str,
        title: str,
        message: str,
        *,
        discriminator: str = "",
        data: Optional[dict] = None,
        evidence: Optional[List[dict]] = None,
        action_path: Optional[str] = None,
        dismissible: bool = True,
    ) -> None:
        nonlocal had_candidate
        had_candidate = True
        insight_id = ":".join(part for part in (code, period, discriminator) if part)
        if not preferences.get(insight_type, True) or insight_id in hidden_ids:
            return
        insights.append({
            "id": insight_id,
            "type": code,
            "code": code,
            "insight_type": insight_type,
            "severity": severity,
            "title": title,
            "message": message,
            "data": data or {},
            "evidence": evidence or [],
            "action_path": action_path,
            "dismissible": dismissible,
            "useful": feedback.get(insight_id),
            "generated_for": period,
        })

    current_income = round(sum(
        item["base_amount"] for item in current_items
        if item.get("type") == "income" and item.get("status") != "pending"
    ), 2)
    current_expense = round(sum(
        item["base_amount"] for item in current_items
        if item.get("type") == "expense" and item.get("status") != "pending"
    ), 2)

    # Savings rate only becomes meaningful after at least one income and two
    # financial movements in the comparable period.
    if current_income > 0 and len(current_items) >= 2:
        net = round(current_income - current_expense, 2)
        rate = round((net / current_income) * 100, 1)
        if net < 0:
            add(
                "spending_above_income",
                "spending",
                "warning",
                "Gastos acima da receita",
                f"Suas despesas superaram a receita em {fmt_eur(abs(net), currency)} neste mês.",
                data={"amount": abs(net), "rate": rate},
                evidence=[
                    {"key": "income_to_date", "value": current_income, "format": "money"},
                    {"key": "expense_to_date", "value": current_expense, "format": "money"},
                    {"key": "difference", "value": abs(net), "format": "money"},
                ],
                action_path=f"/lancamentos?type=expense&year={today.year}&month={today.month}",
            )
        elif rate >= 10:
            add(
                "savings_rate",
                "economy",
                "good",
                "Economia do mês",
                f"Você preservou {rate}% da sua receita até agora ({fmt_eur(net, currency)}).",
                data={"amount": net, "rate": rate},
                evidence=[
                    {"key": "income_to_date", "value": current_income, "format": "money"},
                    {"key": "expense_to_date", "value": current_expense, "format": "money"},
                    {"key": "savings_rate", "value": rate, "format": "percent"},
                ],
                action_path="/metas",
            )

    current_by_category = defaultdict(float)
    previous_by_category = defaultdict(float)
    current_category_count = defaultdict(int)
    previous_category_count = defaultdict(int)
    for item in current_items:
        category_id = item.get("category_id")
        if (
            item.get("type") == "expense"
            and item.get("status") != "pending"
            and category_id
        ):
            current_by_category[category_id] += item["base_amount"]
            current_category_count[category_id] += 1
    for item in previous_items:
        category_id = item.get("category_id")
        if (
            item.get("type") == "expense"
            and item.get("status") != "pending"
            and category_id
        ):
            previous_by_category[category_id] += item["base_amount"]
            previous_category_count[category_id] += 1

    # Compare equal portions of consecutive months. The endpoint deliberately
    # supplies only days 1..today for both periods.
    growing_categories = []
    for category_id, current_amount in current_by_category.items():
        previous_amount = previous_by_category.get(category_id, 0)
        if (
            previous_amount >= 20
            and current_category_count[category_id] >= 2
            and previous_category_count[category_id] >= 1
        ):
            previous_daily = previous_amount / previous_period_days
            expected_current = previous_daily * max(today.day, 1)
            change = ((current_amount - expected_current) / expected_current) * 100
            if change >= 15 and current_amount - expected_current >= 10:
                growing_categories.append(
                    (
                        current_amount - expected_current,
                        category_id,
                        current_amount,
                        previous_amount,
                        change,
                    )
                )
    if growing_categories:
        _, category_id, current_amount, previous_amount, change = max(growing_categories)
        category_name = category_map.get(category_id, "Outros")
        add(
            "category_growth",
            "spending",
            "warning",
            "Categoria em alta",
            f"Seus gastos com {category_name} aumentaram {round(change, 1)}% no mesmo intervalo do mês anterior.",
            discriminator=category_id,
            data={
                "category_id": category_id,
                "category": category_name,
                "current_amount": round(current_amount, 2),
                "previous_amount": round(previous_amount, 2),
                "percent": round(change, 1),
            },
            evidence=[
                {"key": "category_current", "value": round(current_amount, 2), "format": "money"},
                {"key": "category_previous", "value": round(previous_amount, 2), "format": "money"},
                {"key": "variation", "value": round(change, 1), "format": "percent"},
            ],
            action_path=(
                f"/lancamentos?type=expense&category_id={category_id}"
                f"&year={today.year}&month={today.month}"
            ),
        )

    # Forecast the end-of-month balance using the real wallet balance and
    # already registered pending movements. No statistical guess is mixed in.
    projected_balance = round(current_balance, 2)
    negative_on = None
    future_outgoing = 0.0
    for item in sorted(future_cashflows, key=lambda row: row["date"]):
        amount = round(float(item.get("base_amount") or 0), 2)
        if item.get("type") == "income":
            projected_balance += amount
        else:
            projected_balance -= amount
            future_outgoing += amount
        projected_balance = round(projected_balance, 2)
        if projected_balance < 0 and negative_on is None:
            negative_on = item["date"]
    if negative_on:
        day = int(negative_on[-2:])
        add(
            "negative_balance_forecast",
            "balance",
            "critical",
            "Saldo em risco",
            f"Com os lançamentos previstos, seu saldo pode ficar negativo no dia {day}.",
            data={"date": negative_on, "projected_balance": projected_balance},
            evidence=[
                {"key": "current_balance", "value": current_balance, "format": "money"},
                {"key": "pending_outgoing", "value": round(future_outgoing, 2), "format": "money"},
                {"key": "projected_balance", "value": projected_balance, "format": "money"},
            ],
            action_path=f"/lancamentos?status=pending&year={today.year}&month={today.month}",
        )
    elif future_outgoing > 0:
        add(
            "month_covered",
            "balance",
            "good",
            "Contas previstas cobertas",
            f"Seu saldo cobre os lançamentos pendentes do mês, com previsão de {fmt_eur(projected_balance, currency)} ao final.",
            data={"projected_balance": projected_balance, "future_outgoing": round(future_outgoing, 2)},
            evidence=[
                {"key": "current_balance", "value": current_balance, "format": "money"},
                {"key": "pending_outgoing", "value": round(future_outgoing, 2), "format": "money"},
                {"key": "projected_balance", "value": projected_balance, "format": "money"},
            ],
            action_path=f"/lancamentos?status=pending&year={today.year}&month={today.month}",
        )

    upcoming = [
        item for item in future_cashflows
        if item.get("recurrence_id") and item.get("type") == "expense"
        and 0 <= (date.fromisoformat(item["date"]) - today).days <= 7
    ]
    if upcoming:
        nearest = min(upcoming, key=lambda item: item["date"])
        days = (date.fromisoformat(nearest["date"]) - today).days
        description = nearest.get("description") or "Uma conta recorrente"
        when = "hoje" if days == 0 else (
            "amanhã" if days == 1 else f"em {days} dias"
        )
        add(
            "recurrence_due",
            "recurring",
            "info",
            "Conta recorrente próxima",
            f"{description} vence {when}: {fmt_eur(nearest['base_amount'], currency)}.",
            discriminator=str(nearest.get("recurrence_id") or nearest.get("id") or ""),
            data={
                "days": days,
                "date": nearest["date"],
                "amount": nearest["base_amount"],
                "description": description,
            },
            evidence=[
                {"key": "due_date", "value": nearest["date"], "format": "date"},
                {"key": "amount", "value": nearest["base_amount"], "format": "money"},
            ],
            action_path="/recorrencias",
        )

    if overdue_settlements > 0:
        noun = "acerto pendente" if overdue_settlements == 1 else "acertos pendentes"
        add(
            "overdue_settlements",
            "settlements",
            "warning",
            "Acertos aguardando",
            f"Você possui {overdue_settlements} {noun} há mais de 15 dias.",
            data={"count": overdue_settlements, "days": 15},
            evidence=[
                {"key": "overdue_settlements", "value": overdue_settlements, "format": "number"},
                {"key": "minimum_delay", "value": 15, "format": "days"},
            ],
            action_path="/acertos",
        )

    duplicate_groups = defaultdict(list)
    for item in current_items:
        if item.get("type") not in ("income", "expense"):
            continue
        description = normalized_search_text(item.get("description"))
        key = (
            item.get("date"),
            item.get("type"),
            round(float(item.get("base_amount") or 0), 2),
            item.get("account_id"),
            description,
        )
        duplicate_groups[key].append(item)
    duplicate = next(
        (items for key, items in duplicate_groups.items() if len(items) >= 2 and (key[3] or key[4])),
        None,
    )
    if duplicate:
        sample = duplicate[0]
        add(
            "possible_duplicate",
            "anomalies",
            "warning",
            "Possível duplicidade",
            f"Encontramos {len(duplicate)} lançamentos semelhantes de {fmt_eur(sample['base_amount'], currency)} no mesmo dia.",
            discriminator=str(sample.get("date") or ""),
            data={
                "count": len(duplicate),
                "date": sample.get("date"),
                "amount": sample.get("base_amount"),
            },
            evidence=[
                {"key": "similar_entries", "value": len(duplicate), "format": "number"},
                {"key": "amount", "value": sample.get("base_amount"), "format": "money"},
                {"key": "transaction_date", "value": sample.get("date"), "format": "date"},
            ],
            action_path=(
                f"/lancamentos?year={today.year}&month={today.month}"
            ),
        )

    # Practical savings opportunities require repeated behavior in both
    # comparable periods. The estimate restores the previous daily pace; it
    # never assumes that already-spent money can be recovered.
    reducible_categories = []
    for category_id, current_amount in current_by_category.items():
        previous_amount = previous_by_category.get(category_id, 0)
        if (
            previous_amount < 20
            or current_category_count[category_id] < 2
            or previous_category_count[category_id] < 2
        ):
            continue
        current_daily = current_amount / max(today.day, 1)
        previous_daily = previous_amount / previous_period_days
        expected_current = previous_daily * max(today.day, 1)
        increase = current_amount - expected_current
        percent = (increase / expected_current) * 100
        monthly_impact = (current_daily - previous_daily) * days_in_month
        if increase < 10 or percent < 15 or monthly_impact < 10:
            continue
        monthly_target = previous_daily * days_in_month
        remaining_limit = max(monthly_target - current_amount, 0)
        reducible_categories.append({
            "category_id": category_id,
            "category": category_map.get(category_id, "Outros"),
            "current_amount": round(current_amount, 2),
            "previous_amount": round(previous_amount, 2),
            "excess_to_date": round(increase, 2),
            "monthly_impact": round(monthly_impact, 2),
            "remaining_limit": round(remaining_limit, 2),
            "daily_limit": round(remaining_limit / days_remaining, 2),
            "percent": round(percent, 1),
        })
    reducible_categories.sort(
        key=lambda item: (-item["monthly_impact"], item["category"]),
    )
    top_reducible = reducible_categories[:3]
    if top_reducible:
        monthly_impact = round(sum(
            item["monthly_impact"] for item in top_reducible
        ), 2)
        add(
            "savings_opportunity",
            "economy",
            "opportunity",
            "Oportunidade de economia",
            "Algumas categorias estão acima do seu padrão recente.",
            data={
                "categories": top_reducible,
                "category_names": [item["category"] for item in top_reducible],
                "monthly_impact": monthly_impact,
                "days_remaining": days_remaining,
            },
            evidence=[
                {"key": "estimated_monthly_impact", "value": monthly_impact, "format": "money"},
                {"key": "categories_analyzed", "value": len(top_reducible), "format": "number"},
                {"key": "comparable_days", "value": previous_period_days, "format": "days"},
            ],
            action_path=f"/lancamentos?type=expense&year={today.year}&month={today.month}",
        )

    # Phase 3: repeated trends require at least three valid historical periods.
    for account in account_trends:
        values = [round(float(value), 2) for value in account.get("values", [])]
        if len(values) < 4:
            continue
        deltas = [round(values[index] - values[index - 1], 2)
                  for index in range(1, len(values))]
        streak = 0
        for delta in reversed(deltas):
            if delta > 0:
                streak += 1
            else:
                break
        if streak < 3:
            continue
        growth = round(values[-1] - values[-streak - 1], 2)
        if growth < 10:
            continue
        add(
            "account_growth_streak",
            "balance",
            "good",
            "Conta crescendo",
            "O saldo desta conta cresceu por vários meses consecutivos.",
            discriminator=str(account.get("account_id") or ""),
            data={
                "account_id": account.get("account_id"),
                "account": account.get("name") or "Conta",
                "months": streak,
                "growth": growth,
                "currency": account.get("currency", currency),
                "values": values[-(streak + 1):],
            },
            evidence=[
                {"key": "consecutive_months", "value": streak, "format": "months"},
                {"key": "account_growth", "value": growth, "format": "money"},
                {"key": "starting_balance", "value": values[-streak - 1], "format": "money"},
                {"key": "ending_balance", "value": values[-1], "format": "money"},
            ],
            action_path="/carteiras",
        )

    # Accelerating categories grow in two consecutive month-over-month steps,
    # and the latest percentage increase must be stronger than the previous one.
    category_months = defaultdict(list)
    for month in historical_months[:-1][-3:]:
        totals = defaultdict(float)
        counts = defaultdict(int)
        for row in month.get("items", []):
            if (
                row.get("type") == "expense"
                and row.get("status") != "pending"
                and row.get("category_id")
            ):
                totals[row["category_id"]] += float(row.get("base_amount") or 0)
                counts[row["category_id"]] += 1
        for category_id in set(totals) | set(category_months):
            category_months[category_id].append(
                (round(totals.get(category_id, 0), 2), counts.get(category_id, 0))
            )
    accelerated = []
    for category_id, points in category_months.items():
        if len(points) < 3:
            continue
        (first, first_count), (second, second_count), (latest, latest_count) = points[-3:]
        if min(first, second) < 20 or min(first_count, second_count, latest_count) < 1:
            continue
        first_rate = ((second - first) / first) * 100
        latest_rate = ((latest - second) / second) * 100
        if first_rate >= 10 and latest_rate >= 20 and latest_rate > first_rate + 5 and latest - second >= 10:
            accelerated.append((latest_rate, category_id, first, second, latest, first_rate))
    if accelerated:
        latest_rate, category_id, first, second, latest, first_rate = max(accelerated)
        category_name = category_map.get(category_id, "Outros")
        add(
            "category_acceleration",
            "spending",
            "warning",
            "Categoria acelerando",
            "Esta categoria aumentou em meses consecutivos e ganhou velocidade.",
            discriminator=category_id,
            data={
                "category_id": category_id,
                "category": category_name,
                "previous_percent": round(first_rate, 1),
                "latest_percent": round(latest_rate, 1),
                "values": [first, second, latest],
            },
            evidence=[
                {"key": "three_month_values", "value": [first, second, latest], "format": "money_list"},
                {"key": "previous_growth", "value": round(first_rate, 1), "format": "percent"},
                {"key": "latest_growth", "value": round(latest_rate, 1), "format": "percent"},
            ],
            action_path=f"/lancamentos?type=expense&category_id={category_id}",
        )

    # Outliers use the median absolute deviation of the same category. This is
    # intentionally robust against one old extreme expense skewing the baseline.
    history_by_category = defaultdict(list)
    for month in historical_months[:-1]:
        for row in month.get("items", []):
            if (
                row.get("type") == "expense"
                and row.get("status") != "pending"
                and row.get("category_id")
            ):
                history_by_category[row["category_id"]].append(
                    float(row.get("base_amount") or 0)
                )
    unusual = []
    for row in current_items:
        category_id = row.get("category_id")
        sample = history_by_category.get(category_id, [])
        amount_value = float(row.get("base_amount") or 0)
        if row.get("type") != "expense" or row.get("status") == "pending" or len(sample) < 5:
            continue
        median = statistics.median(sample)
        deviations = [abs(value - median) for value in sample]
        mad = statistics.median(deviations)
        threshold = max(median * 2, median + 3 * mad, median + 20)
        if amount_value >= threshold:
            unusual.append((amount_value - median, row, median, threshold))
    if unusual:
        _, row, median, threshold = max(unusual)
        category_name = category_map.get(row.get("category_id"), "Outros")
        add(
            "unusual_expense",
            "anomalies",
            "warning",
            "Gasto fora do habitual",
            "Um lançamento ficou bem acima do padrão desta categoria.",
            discriminator=str(row.get("id") or ""),
            data={
                "transaction_id": row.get("id"),
                "category": category_name,
                "description": row.get("description") or category_name,
                "amount": round(float(row.get("base_amount") or 0), 2),
                "median": round(median, 2),
                "threshold": round(threshold, 2),
                "sample_size": len(history_by_category[row.get("category_id")]),
            },
            evidence=[
                {"key": "transaction_amount", "value": round(float(row.get("base_amount") or 0), 2), "format": "money"},
                {"key": "category_median", "value": round(median, 2), "format": "money"},
                {"key": "historical_entries", "value": len(history_by_category[row.get("category_id")]), "format": "number"},
            ],
            action_path=f"/lancamentos?year={today.year}&month={today.month}",
        )

    full_previous_months = [
        month for month in historical_months[:-1]
        if month.get("days", 0) >= 28
    ][-3:]
    previous_daily_values = []
    for month in full_previous_months:
        expense = sum(
            float(row.get("base_amount") or 0)
            for row in month.get("items", [])
            if row.get("type") == "expense" and row.get("status") != "pending"
        )
        previous_daily_values.append(expense / max(int(month.get("days") or 1), 1))
    current_daily = current_expense / max(today.day, 1)
    if len(previous_daily_values) >= 3:
        normal_daily = statistics.median(previous_daily_values)
        change = ((current_daily - normal_daily) / normal_daily * 100) if normal_daily > 0 else 0
        if change >= 20 and current_daily - normal_daily >= 2:
            add(
                "daily_spending_above_normal",
                "spending",
                "warning",
                "Média diária acima do normal",
                "Seu ritmo diário de despesas está acima dos últimos meses.",
                data={
                    "current_daily": round(current_daily, 2),
                    "normal_daily": round(normal_daily, 2),
                    "percent": round(change, 1),
                    "months": len(previous_daily_values),
                },
                evidence=[
                    {"key": "current_daily_average", "value": round(current_daily, 2), "format": "money"},
                    {"key": "historical_daily_average", "value": round(normal_daily, 2), "format": "money"},
                    {"key": "variation", "value": round(change, 1), "format": "percent"},
                    {"key": "months_analyzed", "value": len(previous_daily_values), "format": "months"},
                ],
                action_path=f"/lancamentos?type=expense&year={today.year}&month={today.month}",
            )

    average_income = float(recurring_burden.get("average_income") or 0)
    fixed_total = float(recurring_burden.get("fixed_total") or 0)
    largest_fixed = float(recurring_burden.get("largest_amount") or 0)
    if average_income > 0 and fixed_total > 0:
        fixed_share = round(fixed_total / average_income * 100, 1)
        largest_share = round(largest_fixed / average_income * 100, 1)
        severity = "warning" if fixed_share >= 50 or largest_share >= 35 else "info"
        if fixed_share >= 30 or largest_share >= 25:
            add(
                "income_commitment",
                "spending",
                severity,
                "Renda comprometida",
                "Uma parte relevante da sua renda média está comprometida com despesas recorrentes.",
                discriminator=str(recurring_burden.get("largest_id") or ""),
                data={
                    "average_income": round(average_income, 2),
                    "fixed_total": round(fixed_total, 2),
                    "fixed_share": fixed_share,
                    "largest_name": recurring_burden.get("largest_name") or "Maior despesa",
                    "largest_amount": round(largest_fixed, 2),
                    "largest_share": largest_share,
                },
                evidence=[
                    {"key": "average_monthly_income", "value": round(average_income, 2), "format": "money"},
                    {"key": "recurring_expenses", "value": round(fixed_total, 2), "format": "money"},
                    {"key": "income_committed", "value": fixed_share, "format": "percent"},
                ],
                action_path="/recorrencias",
            )

    if len(wealth_history) >= 4:
        start_wealth = float(wealth_history[-4].get("value") or 0)
        end_wealth = float(wealth_history[-1].get("value") or 0)
        delta = round(end_wealth - start_wealth, 2)
        if abs(delta) >= 20:
            add(
                "wealth_evolution",
                "balance",
                "good" if delta > 0 else "warning",
                "Evolução patrimonial",
                "Seu patrimônio consolidado mudou nos últimos três meses.",
                data={
                    "start": round(start_wealth, 2),
                    "current": round(end_wealth, 2),
                    "delta": delta,
                    "direction": "up" if delta > 0 else "down",
                    "series": wealth_history[-6:],
                },
                evidence=[
                    {"key": "starting_wealth", "value": round(start_wealth, 2), "format": "money"},
                    {"key": "current_wealth", "value": round(end_wealth, 2), "format": "money"},
                    {"key": "wealth_change", "value": delta, "format": "money"},
                ],
                action_path="/carteiras",
            )

    incomplete_goals = [
        goal for goal in goals
        if float(goal.get("target_amount") or 0) > float(goal.get("current_amount") or 0)
    ]
    if incomplete_goals:
        ranked_goals = sorted(
            incomplete_goals,
            key=lambda goal: (
                goal.get("deadline") or "9999-12-31",
                -float(goal.get("progress_percent") or 0),
            ),
        )
        goal = ranked_goals[0]
        forecast_date = goal.get("forecast_date")
        add(
            "goal_progress",
            "economy",
            "warning" if goal.get("behind_schedule") else "info",
            "Acompanhamento de meta",
            "A meta prioritária ganhou uma nova projeção de progresso.",
            discriminator=str(goal.get("id") or ""),
            data={
                "goal_id": goal.get("id"),
                "title": goal.get("title") or "Meta",
                "current_amount": round(float(goal.get("current_amount") or 0), 2),
                "target_amount": round(float(goal.get("target_amount") or 0), 2),
                "progress_percent": round(float(goal.get("progress_percent") or 0), 1),
                "deadline": goal.get("deadline"),
                "forecast_date": forecast_date,
                "monthly_pace": round(float(goal.get("monthly_pace") or 0), 2),
                "behind_schedule": bool(goal.get("behind_schedule")),
            },
            evidence=[
                {"key": "goal_progress", "value": round(float(goal.get("progress_percent") or 0), 1), "format": "percent"},
                {"key": "amount_remaining", "value": round(float(goal.get("target_amount") or 0) - float(goal.get("current_amount") or 0), 2), "format": "money"},
                {"key": "monthly_contribution_pace", "value": round(float(goal.get("monthly_pace") or 0), 2), "format": "money"},
                *([{"key": "forecast_completion", "value": forecast_date, "format": "date"}] if forecast_date else []),
            ],
            action_path="/metas",
        )

    if recurring_candidates:
        candidate = max(
            recurring_candidates,
            key=lambda row: (int(row.get("occurrences") or 0), float(row.get("amount") or 0)),
        )
        add(
            "recurring_charge_detected",
            "recurring",
            "info",
            "Possível cobrança recorrente",
            "Encontramos uma cobrança repetida que ainda não está cadastrada como recorrência.",
            discriminator=str(candidate.get("key") or ""),
            data=candidate,
            evidence=[
                {"key": "occurrences", "value": candidate.get("occurrences"), "format": "number"},
                {"key": "typical_amount", "value": candidate.get("amount"), "format": "money"},
                {"key": "average_interval", "value": candidate.get("interval_days"), "format": "days"},
            ],
            action_path="/recorrencias",
        )

    realized_items = [
        item for item in current_items if item.get("status") != "pending"
    ]
    realized_income = round(sum(
        item["base_amount"] for item in realized_items
        if item.get("type") == "income"
    ), 2)
    realized_expense = round(sum(
        item["base_amount"] for item in realized_items
        if item.get("type") == "expense"
    ), 2)
    pending_income = round(sum(
        item["base_amount"] for item in future_cashflows
        if item.get("type") == "income"
    ), 2)
    pending_expense = round(sum(
        item["base_amount"] for item in future_cashflows
        if item.get("type") == "expense"
    ), 2)
    available_to_spend = round(
        realized_income + pending_income - realized_expense - pending_expense,
        2,
    )
    if realized_income > 0 and available_to_spend > 0:
        daily_limit = round(available_to_spend / days_remaining, 2)
        add(
            "spending_limit",
            "spending",
            "opportunity",
            "Limite de gastos até o fim do mês",
            "Há orçamento disponível depois das despesas já registradas.",
            data={
                "available_to_spend": available_to_spend,
                "daily_limit": daily_limit,
                "days_remaining": days_remaining,
            },
            evidence=[
                {"key": "realized_income", "value": realized_income, "format": "money"},
                {"key": "realized_expense", "value": realized_expense, "format": "money"},
                {"key": "pending_income", "value": pending_income, "format": "money"},
                {"key": "pending_expense", "value": pending_expense, "format": "money"},
                {"key": "days_remaining", "value": days_remaining, "format": "days"},
            ],
            action_path=f"/lancamentos?year={today.year}&month={today.month}",
        )

    if not insights and not had_candidate:
        add(
            "insufficient_data",
            "spending",
            "info",
            "Sem dados suficientes",
            "Continue registrando receitas e despesas para receber análises úteis.",
            dismissible=False,
        )

    insights.sort(key=lambda item: (
        INSIGHT_PRIORITY.get(item["severity"], 99),
        item["id"],
    ))
    return insights[:10]


async def _insight_installment_items(
    user: dict,
    start: str,
    end: str,
    currencies: dict,
) -> List[dict]:
    installments = await db.installments.find(
        {"user_id": user["id"], "due_date": {"$gte": start, "$lt": end}},
        {"_id": 0},
    ).to_list(3000)
    if not installments:
        return []
    purchase_ids = list({item["purchase_id"] for item in installments})
    purchases = await db.installment_purchases.find(
        {"id": {"$in": purchase_ids}, "user_id": user["id"]},
        {"_id": 0},
    ).to_list(1000)
    purchase_map = {item["id"]: item for item in purchases}
    base_currency = normalize_currency(user.get("currency"))
    rows = []
    for installment in installments:
        purchase = purchase_map.get(installment.get("purchase_id"), {})
        doc = {**purchase, "amount": installment.get("amount", 0)}
        if not doc.get("currency"):
            doc["currency"] = currencies.get(doc.get("account_id"), base_currency)
        rows.append({
            **installment,
            "type": "expense",
            "date": installment.get("due_date"),
            "category_id": purchase.get("category_id"),
            "account_id": purchase.get("account_id"),
            "description": purchase.get("description", ""),
            "base_amount": round(amount_in_currency(doc, base_currency), 2),
            "source": "installment",
        })
    return rows


async def _insight_account_balance(
    user: dict,
    accounts: List[dict],
    paid_transactions: List[dict],
    adjustments: List[dict],
    currencies: dict,
) -> float:
    base_currency = normalize_currency(user.get("currency"))
    total = 0.0
    for account in accounts:
        doc = {
            **account,
            "amount": account.get("initial_balance", 0),
            "currency": normalize_currency(account.get("currency"), base_currency),
        }
        total += amount_in_currency(doc, base_currency)
    for transaction in paid_transactions:
        if transaction.get("type") not in ("income", "expense"):
            continue
        doc = dict(transaction)
        if not doc.get("currency"):
            doc["currency"] = currencies.get(doc.get("account_id"), base_currency)
        amount = amount_in_currency(doc, base_currency)
        total += amount if doc["type"] == "income" else -amount
    accounts_by_id = {account["id"]: account for account in accounts}
    for adjustment in adjustments:
        account = accounts_by_id.get(adjustment.get("account_id"))
        if not account:
            continue
        total += amount_in_currency(
            {
                **account,
                "currency": normalize_currency(
                    account.get("currency"),
                    base_currency,
                ),
                "amount": adjustment.get("amount", 0),
            },
            base_currency,
        )
    paid_installments = await _insight_installment_items(
        user, "1900-01-01", "2201-01-01", currencies,
    )
    total -= sum(
        item["base_amount"] for item in paid_installments
        if item.get("status") == "paid"
    )
    return round(total, 2)


def _overdue_settlement_count(
    expenses: List[dict],
    user_id: str,
    cutoff: date,
) -> int:
    count = 0
    for expense in expenses:
        try:
            expense_date = date.fromisoformat(str(expense.get("date"))[:10])
        except (TypeError, ValueError):
            continue
        if expense_date > cutoff:
            continue
        payer_id = expense.get("payer_id")
        for participant in expense.get("participants", []):
            party_id = participant_reference(participant)
            if (
                participant.get("paid_back")
                or not party_id
                or party_id == payer_id
            ):
                continue
            if payer_id == user_id or party_id == user_id:
                count += 1
    return count


def _month_shift(value: date, offset: int) -> date:
    absolute = value.year * 12 + value.month - 1 + offset
    return date(absolute // 12, absolute % 12 + 1, 1)


def _month_periods(today: date, count: int = 7) -> List[dict]:
    periods = []
    for offset in range(-(count - 1), 1):
        start = _month_shift(date(today.year, today.month, 1), offset)
        next_start = _month_shift(start, 1)
        is_current = start.year == today.year and start.month == today.month
        end = today + timedelta(days=1) if is_current else next_start
        periods.append({
            "period": start.strftime("%Y-%m"),
            "start": start,
            "end": end,
            "days": today.day if is_current else (next_start - start).days,
        })
    return periods


def _build_historical_months(
    periods: List[dict],
    items: List[dict],
) -> List[dict]:
    grouped = defaultdict(list)
    for item in items:
        item_date = str(item.get("date") or "")[:10]
        if len(item_date) >= 7:
            grouped[item_date[:7]].append(item)
    return [
        {
            "period": period["period"],
            "days": period["days"],
            "items": grouped.get(period["period"], []),
        }
        for period in periods
    ]


def _build_account_and_wealth_trends(
    *,
    periods: List[dict],
    accounts: List[dict],
    transactions: List[dict],
    installments: List[dict],
    adjustments: List[dict],
    base_currency: str,
) -> tuple[List[dict], List[dict]]:
    trends = []
    wealth = [{"period": period["period"], "value": 0.0} for period in periods]
    for account in accounts:
        account_id = account["id"]
        account_currency = normalize_currency(account.get("currency"), base_currency)
        values = []
        for index, period in enumerate(periods):
            end = period["end"].isoformat()
            balance = float(account.get("initial_balance") or 0)
            for row in transactions:
                if row.get("status") != "paid" or str(row.get("date") or "")[:10] >= end:
                    continue
                amount = float(row.get("amount") or 0)
                if row.get("type") == "income" and row.get("account_id") == account_id:
                    balance += amount
                elif row.get("type") == "expense" and row.get("account_id") == account_id:
                    balance -= amount
                elif row.get("type") == "transfer":
                    if row.get("from_account_id") == account_id:
                        balance -= amount
                    if row.get("to_account_id") == account_id:
                        balance += float(row.get("target_amount") or amount)
            for installment in installments:
                if (
                    installment.get("status") == "paid"
                    and installment.get("account_id") == account_id
                    and str(installment.get("date") or "")[:10] < end
                ):
                    balance -= float(installment.get("amount") or 0)
            for adjustment in adjustments:
                if (
                    adjustment.get("account_id") == account_id
                    and str(adjustment.get("date") or "")[:10] < end
                ):
                    balance += float(adjustment.get("amount") or 0)
            balance = round(balance, 2)
            values.append(balance)
            wealth[index]["value"] += amount_in_currency(
                {**account, "currency": account_currency, "amount": balance},
                base_currency,
            )
        trends.append({
            "account_id": account_id,
            "name": account.get("name") or "Conta",
            "currency": account_currency,
            "values": values,
        })
    for point in wealth:
        point["value"] = round(point["value"], 2)
    return trends, wealth


def _detect_recurring_charges(items: List[dict]) -> List[dict]:
    groups = defaultdict(list)
    for item in items:
        if (
            item.get("type") != "expense"
            or item.get("status") != "paid"
            or item.get("recurrence_id")
        ):
            continue
        description = normalized_search_text(item.get("description"))
        if len(description) < 3:
            continue
        key = (description, item.get("category_id"), item.get("account_id"))
        groups[key].append(item)
    candidates = []
    for (description, category_id, account_id), rows in groups.items():
        if len(rows) < 3:
            continue
        rows.sort(key=lambda row: row.get("date", ""))
        dates = []
        for row in rows:
            try:
                dates.append(date.fromisoformat(str(row.get("date"))[:10]))
            except ValueError:
                pass
        if len(dates) < 3:
            continue
        gaps = [(dates[index] - dates[index - 1]).days for index in range(1, len(dates))]
        interval = statistics.median(gaps)
        cadence = next((
            label for label, minimum, maximum in (
                ("weekly", 5, 9),
                ("monthly", 25, 35),
                ("yearly", 350, 380),
            )
            if minimum <= interval <= maximum
        ), None)
        if not cadence:
            continue
        tolerated_gap = 4 if cadence == "weekly" else (7 if cadence == "monthly" else 30)
        if sum(abs(gap - interval) <= tolerated_gap for gap in gaps) < len(gaps) - 1:
            continue
        amounts = [float(row.get("base_amount") or 0) for row in rows]
        typical = statistics.median(amounts)
        if typical <= 0 or max(abs(value - typical) / typical for value in amounts) > 0.15:
            continue
        candidates.append({
            "key": hashlib.sha256(
                f"{description}:{category_id}:{account_id}".encode()
            ).hexdigest()[:16],
            "description": rows[-1].get("description") or description,
            "amount": round(typical, 2),
            "occurrences": len(rows),
            "interval_days": round(interval),
            "cadence": cadence,
            "last_date": dates[-1].isoformat(),
        })
    return candidates


def _goal_insight_rows(
    goals: List[dict],
    events: List[dict],
    today: date,
) -> List[dict]:
    by_goal = defaultdict(list)
    for event in events:
        by_goal[event.get("goal_id")].append(event)
    rows = []
    for goal in goals:
        target = float(goal.get("target_amount") or 0)
        current = float(goal.get("current_amount") or 0)
        progress = (current / target * 100) if target > 0 else 0
        positive_events = [
            event for event in by_goal.get(goal.get("id"), [])
            if event.get("type") in ("initial", "contribution", "adjustment")
            and float(event.get("amount") or 0) > 0
        ]
        cutoff = today - timedelta(days=183)
        recent = []
        for event in positive_events:
            try:
                event_date = date.fromisoformat(str(event.get("date"))[:10])
            except ValueError:
                continue
            if event_date >= cutoff:
                recent.append((event_date, float(event.get("amount") or 0)))
        monthly_pace = round(sum(value for _, value in recent) / 6, 2) if len(recent) >= 2 else 0
        forecast_date = None
        remaining = max(target - current, 0)
        if monthly_pace > 0 and remaining > 0:
            months_needed = max(1, int((remaining / monthly_pace) + 0.999999))
            forecast_date = _month_shift(date(today.year, today.month, 1), months_needed).isoformat()
        behind_schedule = False
        deadline_value = goal.get("deadline")
        if deadline_value and target > 0:
            try:
                deadline = date.fromisoformat(str(deadline_value)[:10])
                created = date.fromisoformat(str(goal.get("created_at") or today.isoformat())[:10])
                total_days = max((deadline - created).days, 1)
                elapsed = min(max((today - created).days, 0), total_days)
                expected_progress = elapsed / total_days * 100
                behind_schedule = deadline >= today and progress + 5 < expected_progress
                if forecast_date:
                    behind_schedule = behind_schedule or date.fromisoformat(forecast_date) > deadline
            except ValueError:
                pass
        rows.append({
            **goal,
            "progress_percent": round(progress, 1),
            "monthly_pace": monthly_pace,
            "forecast_date": forecast_date,
            "behind_schedule": behind_schedule,
        })
    return rows


@api.get("/insights")
async def insights(user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    today = now.date()
    month_start = date(today.year, today.month, 1)
    month_end = month_end_date(today.year, today.month)
    previous_month_end = month_start - timedelta(days=1)
    previous_month_start = date(previous_month_end.year, previous_month_end.month, 1)
    comparable_day = min(today.day, previous_month_end.day)
    previous_comparable_end = date(
        previous_month_end.year, previous_month_end.month, comparable_day,
    ) + timedelta(days=1)
    current_end = today + timedelta(days=1)
    historical_periods = _month_periods(today, 7)
    history_start = historical_periods[0]["start"].isoformat()

    await materialize_recurrences(user["id"], month_end)
    current_query = {
        "user_id": user["id"],
        "date": {"$gte": month_start.isoformat(), "$lt": current_end.isoformat()},
        "status": {"$ne": "cancelled"},
    }
    previous_query = {
        "user_id": user["id"],
        "date": {
            "$gte": previous_month_start.isoformat(),
            "$lt": previous_comparable_end.isoformat(),
        },
        "status": {"$ne": "cancelled"},
    }
    accounts, current_transactions, previous_transactions, paid_transactions, account_adjustments, categories, shared, hidden, stored_feedback, goals, goal_events, recurrences = await asyncio.gather(
        db.accounts.find({"user_id": user["id"]}, {"_id": 0}).to_list(500),
        db.transactions.find(current_query, {"_id": 0}).to_list(5000),
        db.transactions.find(previous_query, {"_id": 0}).to_list(5000),
        db.transactions.find(
            {"user_id": user["id"], "status": "paid"}, {"_id": 0},
        ).to_list(20000),
        db.account_adjustments.find(
            {
                "user_id": user["id"],
                "deleted_at": {"$exists": False},
            },
            {"_id": 0},
        ).to_list(5000),
        db.categories.find({"user_id": user["id"]}, {"_id": 0}).to_list(500),
        db.shared_expenses.find(
            visible_shared_query(user["id"]), {"_id": 0},
        ).to_list(5000),
        db.insight_dismissals.find(
            {"user_id": user["id"]}, {"_id": 0, "insight_id": 1},
        ).to_list(1000),
        db.insight_feedback.find(
            {"user_id": user["id"]},
            {"_id": 0, "insight_id": 1, "useful": 1},
        ).to_list(1000),
        db.goals.find({"user_id": user["id"]}, {"_id": 0}).to_list(500),
        db.goal_events.find(
            {"user_id": user["id"], "date": {"$gte": history_start}},
            {"_id": 0},
        ).to_list(5000),
        db.recurrences.find(
            {"user_id": user["id"], "active": True}, {"_id": 0},
        ).to_list(500),
    )
    base_currency = normalize_currency(user.get("currency"))
    currencies = {
        account["id"]: normalize_currency(account.get("currency"), base_currency)
        for account in accounts
    }

    def normalize_items(items: List[dict]) -> List[dict]:
        rows = []
        for item in items:
            if item.get("type") not in ("income", "expense"):
                continue
            doc = dict(item)
            if not doc.get("currency"):
                doc["currency"] = currencies.get(doc.get("account_id"), base_currency)
            rows.append({
                **doc,
                "base_amount": round(amount_in_currency(doc, base_currency), 2),
            })
        return rows

    current_installments, previous_installments, future_installments, historical_installments, current_balance = await asyncio.gather(
        _insight_installment_items(
            user, month_start.isoformat(), current_end.isoformat(), currencies,
        ),
        _insight_installment_items(
            user, previous_month_start.isoformat(),
            previous_comparable_end.isoformat(), currencies,
        ),
        _insight_installment_items(
            user, month_start.isoformat(),
            (month_end + timedelta(days=1)).isoformat(), currencies,
        ),
        _insight_installment_items(
            user, "1900-01-01", current_end.isoformat(), currencies,
        ),
        _insight_account_balance(
            user,
            accounts,
            paid_transactions,
            account_adjustments,
            currencies,
        ),
    )
    current_items = normalize_items(current_transactions) + current_installments
    previous_items = normalize_items(previous_transactions) + previous_installments

    future_transactions = await db.transactions.find(
        {
            "user_id": user["id"],
            "date": {"$gte": month_start.isoformat(), "$lte": month_end.isoformat()},
            "status": "pending",
            "type": {"$in": ["income", "expense"]},
        },
        {"_id": 0},
    ).to_list(5000)
    future_cashflows = normalize_items(future_transactions)
    future_cashflows.extend(
        item for item in future_installments if item.get("status") == "pending"
    )
    # Pending obligations from earlier in the month still reduce the safe
    # spending budget. Treat them as payable today without pretending their
    # original due date is a future due date.
    for item in future_cashflows:
        if item.get("date", "") < today.isoformat():
            item["original_date"] = item.get("date")
            item["date"] = today.isoformat()
            item["recurrence_id"] = None

    # Shared debts do not have a separate due date. Treat them as obligations
    # payable today so the forecast remains conservative and transparent.
    for expense in shared:
        if expense.get("payer_id") == user["id"]:
            continue
        for participant in expense.get("participants", []):
            if (
                participant_reference(participant) == user["id"]
                and not participant.get("paid_back")
            ):
                doc = {**expense, "amount": participant.get("owed", 0)}
                if not doc.get("currency"):
                    doc["currency"] = base_currency
                future_cashflows.append({
                    "id": f"shared:{expense.get('id')}",
                    "type": "expense",
                    "date": today.isoformat(),
                    "base_amount": round(amount_in_currency(doc, base_currency), 2),
                    "description": expense.get("title", ""),
                    "source": "shared_expense",
                })

    historical_paid = [
        row for row in normalize_items(paid_transactions)
        if history_start <= str(row.get("date") or "")[:10] < current_end.isoformat()
    ]
    historical_items = historical_paid + [
        row for row in historical_installments
        if row.get("status") == "paid"
        and history_start <= str(row.get("date") or "")[:10] < current_end.isoformat()
    ]
    historical_months = _build_historical_months(
        historical_periods, historical_items,
    )
    account_trends, wealth_history = _build_account_and_wealth_trends(
        periods=historical_periods,
        accounts=accounts,
        transactions=paid_transactions,
        installments=historical_installments,
        adjustments=account_adjustments,
        base_currency=base_currency,
    )
    recurring_candidates = _detect_recurring_charges(historical_paid)
    completed_months = historical_months[:-1][-3:]
    monthly_income = [
        sum(
            float(row.get("base_amount") or 0)
            for row in month["items"]
            if row.get("type") == "income" and row.get("status") != "pending"
        )
        for month in completed_months
    ]
    frequency_factor = {
        "weekly": 52 / 12,
        "monthly": 1.0,
        "quarterly": 1 / 3,
        "semiannual": 1 / 6,
        "yearly": 1 / 12,
    }
    recurring_expenses = []
    for recurrence in recurrences:
        if recurrence.get("type") != "expense":
            continue
        doc = dict(recurrence)
        if not doc.get("currency"):
            doc["currency"] = currencies.get(doc.get("account_id"), base_currency)
        monthly_amount = amount_in_currency(doc, base_currency) * frequency_factor.get(
            recurrence.get("frequency"), 1.0,
        )
        recurring_expenses.append((monthly_amount, recurrence))
    largest_recurring = max(recurring_expenses, default=(0, {}), key=lambda item: item[0])
    goal_rows = _goal_insight_rows(goals, goal_events, today)

    generated = build_crelith_insights(
        today=today,
        currency=base_currency,
        current_items=current_items,
        previous_items=previous_items,
        categories=categories,
        current_balance=current_balance,
        future_cashflows=future_cashflows,
        overdue_settlements=_overdue_settlement_count(
            shared, user["id"], today - timedelta(days=15),
        ),
        hidden_ids={item["insight_id"] for item in hidden},
        preferences=user.get("insight_prefs"),
        feedback={
            item["insight_id"]: item.get("useful")
            for item in stored_feedback
        },
        comparable_days=comparable_day,
        historical_months=historical_months,
        account_trends=account_trends,
        wealth_history=wealth_history,
        goals=goal_rows,
        recurring_candidates=recurring_candidates,
        recurring_burden={
            "average_income": round(statistics.mean(monthly_income), 2)
            if len(monthly_income) == 3 else 0,
            "fixed_total": round(sum(item[0] for item in recurring_expenses), 2),
            "largest_id": largest_recurring[1].get("id"),
            "largest_name": largest_recurring[1].get("description") or "Maior despesa",
            "largest_amount": round(largest_recurring[0], 2),
        },
    )
    timestamp = now_iso()
    for item in generated:
        await db.insight_history.update_one(
            {"user_id": user["id"], "insight_id": item["id"]},
            {
                "$set": {
                    "snapshot": item,
                    "last_presented_at": timestamp,
                    "status": (
                        "useful" if item.get("useful") is True
                        else "not_useful" if item.get("useful") is False
                        else "presented"
                    ),
                },
                "$setOnInsert": {
                    "id": new_id(),
                    "user_id": user["id"],
                    "insight_id": item["id"],
                    "first_presented_at": timestamp,
                },
            },
            upsert=True,
        )
    return generated


class InsightPreferencesIn(BaseModel):
    prefs: dict


class InsightFeedbackIn(BaseModel):
    useful: bool


@api.get("/insights/preferences")
async def get_insight_preferences(user=Depends(get_current_user)):
    return default_insight_prefs(user.get("insight_prefs"))


@api.put("/insights/preferences")
async def set_insight_preferences(
    body: InsightPreferencesIn,
    user=Depends(get_current_user),
):
    clean = default_insight_prefs(body.prefs)
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"insight_prefs": clean}},
    )
    return clean


@api.get("/insights/history")
async def get_insight_history(
    status: Optional[Literal["presented", "useful", "not_useful", "dismissed"]] = None,
    limit: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
):
    query = {"user_id": user["id"]}
    if status:
        query["status"] = status
    rows = await db.insight_history.find(
        query, {"_id": 0},
    ).sort("last_presented_at", -1).to_list(limit)
    return rows


@api.put("/insights/{insight_id}/feedback")
async def set_insight_feedback(
    insight_id: str,
    body: InsightFeedbackIn,
    user=Depends(get_current_user),
):
    if not insight_id or len(insight_id) > 240:
        raise HTTPException(400, "Insight inválido")
    await db.insight_feedback.update_one(
        {"user_id": user["id"], "insight_id": insight_id},
        {
            "$set": {
                "useful": body.useful,
                "updated_at": now_iso(),
            },
            "$setOnInsert": {"created_at": now_iso()},
        },
        upsert=True,
    )
    await db.insight_history.update_one(
        {"user_id": user["id"], "insight_id": insight_id},
        {
            "$set": {
                "status": "useful" if body.useful else "not_useful",
                "feedback_updated_at": now_iso(),
            },
        },
    )
    return {"ok": True, "useful": body.useful}


@api.post("/insights/{insight_id}/dismiss")
async def dismiss_insight(insight_id: str, user=Depends(get_current_user)):
    if not insight_id or len(insight_id) > 240:
        raise HTTPException(400, "Insight inválido")
    await db.insight_dismissals.update_one(
        {"user_id": user["id"], "insight_id": insight_id},
        {
            "$set": {
                "dismissed_at": now_iso(),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=120),
            },
        },
        upsert=True,
    )
    await db.insight_history.update_one(
        {"user_id": user["id"], "insight_id": insight_id},
        {
            "$set": {
                "status": "dismissed",
                "dismissed_at": now_iso(),
            },
        },
    )
    return {"ok": True}


# ---------- Financial Goals ----------
class GoalIn(BaseModel):
    title: str
    target_amount: float
    current_amount: float = 0.0
    deadline: Optional[str] = None
    color: str = "#1E3F33"
    account_id: Optional[str] = None
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None


class ContributeIn(BaseModel):
    amount: float
    from_account_id: Optional[str] = None


@api.get("/goals")
async def list_goals(
    currency: Optional[str] = None,
    user=Depends(get_current_user),
):
    rows = await db.goals.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    events = await db.goal_events.find(
        {"user_id": user["id"]}, {"_id": 0},
    ).to_list(5000)
    base_currency = normalize_currency(user.get("currency"))
    currencies = await account_currency_map(user)
    for row in rows:
        row["currency"] = normalize_currency(
            row.get("currency"), currencies.get(row.get("account_id"), base_currency)
        )
        row["base_target_amount"] = round(
            amount_in_currency({**row, "amount": row.get("target_amount", 0)}, base_currency),
            2,
        )
        row["base_current_amount"] = round(
            amount_in_currency({**row, "amount": row.get("current_amount", 0)}, base_currency),
            2,
        )
    rows = _goal_insight_rows(
        rows, events, datetime.now(timezone.utc).date(),
    )
    if currency:
        selected_currency = normalize_currency(currency)
        rows = [row for row in rows if row["currency"] == selected_currency]
    return rows


async def goal_currency_values(payload: GoalIn, user: dict) -> tuple[dict, dict]:
    if payload.target_amount <= 0:
        raise HTTPException(400, "O valor alvo deve ser maior que zero")
    if payload.current_amount < 0:
        raise HTTPException(400, "O valor guardado não pode ser negativo")
    currencies = await account_currency_map(user)
    base_currency = normalize_currency(user.get("currency"))
    currency = normalize_currency(
        payload.currency, currencies.get(payload.account_id, base_currency)
    )
    if payload.account_id:
        account_currency = currencies.get(payload.account_id)
        if not account_currency:
            raise HTTPException(404, "Conta vinculada não encontrada")
        if account_currency != currency:
            raise HTTPException(
                400,
                "A moeda da meta deve ser igual à moeda da carteira vinculada",
            )
    rate_date = payload.deadline or datetime.now(timezone.utc).date().isoformat()
    meta = await monetary_metadata(
        currency, base_currency, rate_date, payload.exchange_rate
    )
    values = payload.model_dump(exclude={"currency", "exchange_rate"})
    return values, meta


@api.post("/goals")
async def create_goal(
    payload: GoalIn,
    user=Depends(get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    async def create():
        values, meta = await goal_currency_values(payload, user)
        doc = {"id": new_id(), "user_id": user["id"], **values, **meta,
               "created_at": now_iso()}
        await db.goals.insert_one(doc)
        if float(doc.get("current_amount") or 0) > 0:
            await db.goal_events.insert_one({
                "id": new_id(),
                "user_id": user["id"],
                "goal_id": doc["id"],
                "type": "initial",
                "amount": round(float(doc["current_amount"]), 2),
                "date": now_iso()[:10],
                "created_at": now_iso(),
            })
        doc.pop("_id", None)
        return doc

    return await run_idempotent_create(
        "create_goal", user["id"], idempotency_key,
        payload.model_dump(), create,
    )


@api.put("/goals/{gid}")
async def update_goal(gid: str, payload: GoalIn, user=Depends(get_current_user)):
    current = await db.goals.find_one(
        {"id": gid, "user_id": user["id"]}, {"_id": 0}
    )
    if not current:
        raise HTTPException(404, "Meta não encontrada")
    values, meta = await goal_currency_values(payload, user)
    current_currency = normalize_currency(
        current.get("currency"), user.get("currency", "EUR")
    )
    if (
        normalize_currency(meta["currency"]) != current_currency
        and float(current.get("current_amount") or 0) != 0
    ):
        raise HTTPException(
            400,
            "Não é possível alterar a moeda de uma meta que já possui saldo",
        )
    res = await db.goals.update_one(
        {"id": gid, "user_id": user["id"]}, {"$set": {**values, **meta}})
    if res.matched_count == 0:
        raise HTTPException(404, "Meta não encontrada")
    adjustment = round(
        float(values.get("current_amount") or 0)
        - float(current.get("current_amount") or 0),
        2,
    )
    if adjustment:
        await db.goal_events.insert_one({
            "id": new_id(),
            "user_id": user["id"],
            "goal_id": gid,
            "type": "adjustment",
            "amount": adjustment,
            "date": now_iso()[:10],
            "created_at": now_iso(),
        })
    return await db.goals.find_one({"id": gid}, {"_id": 0})


@api.post("/goals/{gid}/contribute")
async def contribute_goal(gid: str, body: ContributeIn, user=Depends(get_current_user)):
    if body.amount <= 0:
        raise HTTPException(400, "O valor do aporte deve ser maior que zero")
    goal = await db.goals.find_one({"id": gid, "user_id": user["id"]}, {"_id": 0})
    if not goal:
        raise HTTPException(404, "Meta não encontrada")
    goal_currency = normalize_currency(
        goal.get("currency"), user.get("currency", "EUR")
    )

    # Optionally create a real transaction so balances stay coherent
    if body.from_account_id:
        src = await db.accounts.find_one({"id": body.from_account_id, "user_id": user["id"]}, {"_id": 0})
        if not src:
            raise HTTPException(404, "Conta de origem não encontrada")
        if normalize_currency(src.get("currency"), user.get("currency", "EUR")) != goal_currency:
            raise HTTPException(
                400,
                "A carteira do aporte deve usar a mesma moeda da meta",
            )
        linked = goal.get("account_id")
        if linked and linked != body.from_account_id:
            dest = await db.accounts.find_one({"id": linked, "user_id": user["id"]}, {"_id": 0})
            if dest:
                tx = {"type": "transfer", "from_account_id": body.from_account_id,
                      "to_account_id": linked, "account_id": None, "category_id": None}
            else:
                tx = {"type": "expense", "account_id": body.from_account_id,
                      "from_account_id": None, "to_account_id": None, "category_id": None}
        else:
            tx = {"type": "expense", "account_id": body.from_account_id,
                  "from_account_id": None, "to_account_id": None, "category_id": None}
        meta = await monetary_metadata(
            goal_currency,
            user.get("currency", "EUR"),
            datetime.now(timezone.utc).date().isoformat(),
        )
        if tx["type"] == "transfer":
            meta.update({
                "target_currency": goal_currency,
                "target_amount": body.amount,
                "transfer_exchange_rate": 1.0,
                "rate_source": "automatic",
            })
        await db.transactions.insert_one({
            "id": new_id(), "user_id": user["id"], "date": now_iso()[:10],
            "amount": body.amount, "payment_method": None,
            "description": f"Aporte: {goal['title']}", "notes": "(aporte meta)",
            "status": "paid", "goal_id": gid, "created_at": now_iso(),
            **meta, **tx,
        })

    new_amt = round(goal.get("current_amount", 0) + body.amount, 2)
    await db.goals.update_one({"id": gid}, {"$set": {"current_amount": new_amt}})
    await db.goal_events.insert_one({
        "id": new_id(),
        "user_id": user["id"],
        "goal_id": gid,
        "type": "contribution",
        "amount": round(body.amount, 2),
        "date": now_iso()[:10],
        "created_at": now_iso(),
    })
    goal["current_amount"] = new_amt
    return goal


class WithdrawIn(BaseModel):
    amount: float
    to_account_id: Optional[str] = None


@api.post("/goals/{gid}/withdraw")
async def withdraw_goal(gid: str, body: WithdrawIn, user=Depends(get_current_user)):
    if body.amount <= 0:
        raise HTTPException(400, "O valor do resgate deve ser maior que zero")
    goal = await db.goals.find_one({"id": gid, "user_id": user["id"]}, {"_id": 0})
    if not goal:
        raise HTTPException(404, "Meta não encontrada")
    goal_currency = normalize_currency(
        goal.get("currency"), user.get("currency", "EUR")
    )
    current = goal.get("current_amount", 0)
    if body.amount > current:
        raise HTTPException(400, "Valor maior que o saldo da meta")

    # Optionally return the money to an account via a real transaction
    if body.to_account_id:
        dest = await db.accounts.find_one({"id": body.to_account_id, "user_id": user["id"]}, {"_id": 0})
        if not dest:
            raise HTTPException(404, "Conta de destino não encontrada")
        if normalize_currency(dest.get("currency"), user.get("currency", "EUR")) != goal_currency:
            raise HTTPException(
                400,
                "A carteira do resgate deve usar a mesma moeda da meta",
            )
        linked = goal.get("account_id")
        if linked and linked != body.to_account_id:
            src = await db.accounts.find_one({"id": linked, "user_id": user["id"]}, {"_id": 0})
            if src:
                tx = {"type": "transfer", "from_account_id": linked,
                      "to_account_id": body.to_account_id, "account_id": None, "category_id": None}
            else:
                tx = {"type": "income", "account_id": body.to_account_id,
                      "from_account_id": None, "to_account_id": None, "category_id": None}
        else:
            tx = {"type": "income", "account_id": body.to_account_id,
                  "from_account_id": None, "to_account_id": None, "category_id": None}
        meta = await monetary_metadata(
            goal_currency,
            user.get("currency", "EUR"),
            datetime.now(timezone.utc).date().isoformat(),
        )
        if tx["type"] == "transfer":
            meta.update({
                "target_currency": goal_currency,
                "target_amount": body.amount,
                "transfer_exchange_rate": 1.0,
                "rate_source": "automatic",
            })
        await db.transactions.insert_one({
            "id": new_id(), "user_id": user["id"], "date": now_iso()[:10],
            "amount": body.amount, "payment_method": None,
            "description": f"Resgate: {goal['title']}", "notes": "(resgate meta)",
            "status": "paid", "goal_id": gid, "created_at": now_iso(),
            **meta, **tx,
        })

    new_amt = round(current - body.amount, 2)
    await db.goals.update_one({"id": gid}, {"$set": {"current_amount": new_amt}})
    await db.goal_events.insert_one({
        "id": new_id(),
        "user_id": user["id"],
        "goal_id": gid,
        "type": "withdrawal",
        "amount": round(-body.amount, 2),
        "date": now_iso()[:10],
        "created_at": now_iso(),
    })
    goal["current_amount"] = new_amt
    return goal


@api.delete("/goals/{gid}")
async def delete_goal(gid: str, user=Depends(get_current_user)):
    await db.goals.delete_one({"id": gid, "user_id": user["id"]})
    await db.goal_events.delete_many({"goal_id": gid, "user_id": user["id"]})
    return {"ok": True}


# ---------- Seed Demo ----------
@app.on_event("startup")
async def startup():
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    await db.users.create_index("email", unique=True)
    await db.users.create_index([("status", 1), ("created_at", -1)])
    # Keep legacy UUID-backed public IDs fast and fully compatible. MongoDB's
    # native `_id` remains an ObjectId; no existing relationship is rewritten.
    for collection_name in (
        "users", "people", "categories", "accounts", "transactions", "recurrences",
        "installment_purchases", "installments", "receivables", "groups",
        "shared_expenses", "notifications", "goals", "account_adjustments",
    ):
        await db[collection_name].create_index("id")
    # Existing categories are intentionally left untouched. The partial index
    # applies to new/updated records, while endpoint validation also checks
    # legacy records that do not have name_key yet.
    await db.categories.create_index(
        [("user_id", 1), ("name_key", 1)],
        unique=True,
        partialFilterExpression={"name_key": {"$type": "string"}},
    )
    await db.idempotency_requests.create_index(
        [("operation", 1), ("owner_id", 1), ("key", 1)],
        unique=True,
    )
    await db.idempotency_requests.create_index(
        "expires_at",
        expireAfterSeconds=0,
    )
    await db.transactions.create_index([("user_id", 1), ("date", -1)])
    await db.transactions.create_index([("user_id", 1), ("person_id", 1)])
    await db.account_adjustments.create_index(
        [("user_id", 1), ("account_id", 1), ("date", -1)]
    )
    await db.recurrences.create_index([("user_id", 1), ("person_id", 1)])
    await db.people.create_index([("owner_user_id", 1), ("name", 1)])
    await db.shared_expenses.create_index("participant_ids")
    await db.shared_expenses.create_index([("creator_id", 1), ("status", 1), ("date", -1)])
    await db.shared_expenses.create_index([("participant_ids", 1), ("status", 1), ("date", -1)])
    await db.settlement_history.create_index(
        [("debtor_id", 1), ("paid_at", -1)]
    )
    await db.settlement_history.create_index(
        [("creditor_id", 1), ("paid_at", -1)]
    )
    await db.settlement_history.create_index(
        [("expense_id", 1), ("debtor_id", 1)]
    )
    repaired_settlements = await backfill_shared_settlement_history()
    if repaired_settlements:
        logger.info(
            "Settlement history backfill checked %s paid participant(s)",
            repaired_settlements,
        )
    await db.groups.create_index("member_ids")
    await db.groups.create_index("admin_ids")
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.insight_dismissals.create_index(
        [("user_id", 1), ("insight_id", 1)],
        unique=True,
    )
    await db.insight_dismissals.create_index(
        "expires_at",
        expireAfterSeconds=0,
    )
    await db.insight_feedback.create_index(
        [("user_id", 1), ("insight_id", 1)],
        unique=True,
    )
    await db.websocket_tickets.create_index("ticket_hash", unique=True)
    await db.websocket_tickets.create_index(
        "expires_at",
        expireAfterSeconds=0,
    )
    await db.password_reset_tokens.create_index("token_hash", unique=True)
    await db.password_reset_tokens.create_index(
        "expires_at",
        expireAfterSeconds=0,
    )
    await db.password_reset_requests.create_index(
        "created_at",
        expireAfterSeconds=86400,
    )
    await db.email_templates.create_index("id", unique=True)

    # Backfill: garantir categorias padrão de receita para usuários existentes
    income_defaults = [c for c in DEFAULT_CATEGORIES if c[3] == "income"]
    async for u in db.users.find(
        {
            "$or": [
                {"status": "active"},
                {"status": {"$exists": False}},
            ],
        },
        {"id": 1},
    ):
        uid = u["id"]
        existing_name_keys = set()
        async for c in db.categories.find(
            {"user_id": uid},
            {"name": 1, "name_key": 1},
        ):
            existing_name_keys.add(
                c.get("name_key")
                or category_name_key(c.get("name"))
            )
        for name, icon, color, kind in income_defaults:
            name_key = category_name_key(name)
            if name_key in existing_name_keys:
                continue
            await db.categories.insert_one({
                "id": new_id(), "user_id": uid, "name": name,
                "name_key": name_key,
                "icon": icon, "color": color, "kind": kind,
                "is_default": True, "created_at": now_iso(),
            })
            existing_name_keys.add(name_key)

    if os.environ.get("SEED_DEMO", "false").lower() != "true":
        return
    if await db.users.find_one({"email": "wendy@demo.com"}):
        return
    demo = [
        ("Wendy", "wendy@demo.com", "demo123"),
        ("Marilia", "marilia@demo.com", "demo123"),
        ("Nathalia", "nathalia@demo.com", "demo123"),
    ]
    ids = {}
    for name, email, pw in demo:
        uid = new_id()
        await db.users.insert_one({
            "id": uid, "name": name, "email": email,
            "password_hash": hash_password(pw),
            "currency": "EUR", "avatar_color": user_color(name),
            "status": "active",
            "created_at": now_iso(),
        })
        await seed_user_defaults(uid)
        ids[name] = uid

    # Create a group "Casa" with the three
    gid = new_id()
    await db.groups.insert_one({
        "id": gid, "name": "Casa", "description": "Despesas compartilhadas da casa",
        "creator_id": ids["Wendy"],
        "member_ids": list(ids.values()),
        "created_at": now_iso(),
    })

    # Create a shared expense: Mercado 222, paid by Wendy, split equally
    sid = new_id()
    per = round(222 / 3, 2)
    parts = [
        {"user_id": ids["Wendy"], "owed": per, "paid_back": False},
        {"user_id": ids["Marilia"], "owed": per, "paid_back": False},
        {"user_id": ids["Nathalia"], "owed": 222 - 2 * per, "paid_back": False},
    ]
    await db.shared_expenses.insert_one({
        "id": sid, "creator_id": ids["Wendy"],
        "title": "Mercado", "amount": 222.0, "date": now_iso()[:10],
        "category": "Mercado", "payer_id": ids["Wendy"],
        "split_type": "equal", "group_id": gid, "notes": "Compra do mês",
        "participants": parts,
        "participant_ids": list(ids.values()),
        "status": "open", "created_at": now_iso(),
    })

    # Add a few personal transactions for Wendy
    wid = ids["Wendy"]
    cats = await db.categories.find({"user_id": wid}).to_list(50)
    cat_by_name = {c["name"]: c["id"] for c in cats}
    today = datetime.now(timezone.utc).date()
    sample = [
        ("income", today.replace(day=1).isoformat(), 2500.0, None, "Salário"),
        ("expense", today.isoformat(), 850.0, cat_by_name.get("Moradia"), "Aluguel"),
        ("expense", today.isoformat(), 120.0, cat_by_name.get("Transporte"), "Transporte"),
        ("expense", today.isoformat(), 60.0, cat_by_name.get("Lazer"), "Cinema"),
    ]
    for t, d, amt, cid, desc in sample:
        await db.transactions.insert_one({
            "id": new_id(), "user_id": wid, "type": t, "date": d,
            "amount": amt, "category_id": cid, "account_id": None,
            "payment_method": "Cartão", "description": desc, "notes": "",
            "status": "paid", "created_at": now_iso(),
        })
    logger.info("Demo seed completed (users: wendy/marilia/nathalia @demo.com / demo123)")


# ---------- App wiring ----------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=configured_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
