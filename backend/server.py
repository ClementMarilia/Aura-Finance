from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import asyncio
import calendar
import requests
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal
from fastapi import (
    FastAPI, APIRouter, HTTPException, Depends, Request, WebSocket,
    WebSocketDisconnect, UploadFile, File, Header, Query,
)
from fastapi.responses import Response
from fastapi.security import HTTPBearer
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from collections import defaultdict

# ---------- Config ----------
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

DEFAULT_CORS_ORIGINS = (
    "https://www.crelithtech.com,"
    "https://crelithtech.com,"
    "https://aura-finance-inky.vercel.app,"
    "http://localhost:3000"
)


def configured_cors_origins() -> List[str]:
    raw_origins = os.environ.get("CORS_ORIGINS", DEFAULT_CORS_ORIGINS)
    return [
        origin.strip().rstrip("/")
        for origin in raw_origins.split(",")
        if origin.strip()
    ]


app = FastAPI(title="Controle Financeiro")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("finance")

SUPPORTED_CURRENCIES = ("EUR", "BRL", "USD", "CHF")
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


ws_manager = ConnectionManager()


# ---------- Helpers ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


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


class UpdateProfileIn(BaseModel):
    name: Optional[str] = None
    currency: Optional[str] = None


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


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


class TransactionIn(BaseModel):
    type: Literal["income", "expense", "transfer"]
    date: str  # ISO date
    amount: float
    category_id: Optional[str] = None
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


class ParticipantSplit(BaseModel):
    user_id: str
    amount: Optional[float] = None
    percent: Optional[float] = None


class SharedExpenseIn(BaseModel):
    title: str
    amount: float
    date: str
    category: str = "Outros"
    payer_id: str
    participants: List[ParticipantSplit]
    split_type: Literal["equal", "manual", "percent"] = "equal"
    group_id: Optional[str] = None
    notes: str = ""
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None


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
    for name, icon, color, kind in DEFAULT_CATEGORIES:
        await db.categories.insert_one({
            "id": new_id(), "user_id": user_id, "name": name,
            "icon": icon, "color": color, "kind": kind,
            "is_default": True, "created_at": now_iso(),
        })
    await db.accounts.insert_one({
        "id": new_id(), "user_id": user_id, "name": "Conta Principal",
        "type": "checking", "initial_balance": 0.0,
        "currency": normalize_currency(currency), "created_at": now_iso(),
    })


def user_color(name: str) -> str:
    palette = ["#1E3F33", "#D96C5B", "#E5A83B", "#7EA193", "#3B82F6", "#C7BCA1"]
    return palette[sum(ord(c) for c in name) % len(palette)]


def public_user(u: dict) -> dict:
    return {
        "id": u["id"], "name": u["name"], "email": u["email"],
        "currency": u.get("currency", "EUR"),
        "avatar_color": u.get("avatar_color", "#1E3F33"),
        "created_at": u.get("created_at", ""),
        "security_question": u.get("security_question") or None,
        "has_security_question": bool(u.get("security_answer_hash")),
    }


# ---------- Auth ----------
@api.post("/auth/register")
async def register(payload: RegisterIn):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")
    uid = new_id()
    currency = normalize_currency(payload.currency)
    user = {
        "id": uid, "name": payload.name, "email": email,
        "password_hash": hash_password(payload.password),
        "currency": currency, "avatar_color": user_color(payload.name),
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    await seed_user_defaults(uid, currency)
    token = create_token(uid, email)
    return {"token": token, "user": public_user(user)}


@api.post("/auth/login")
async def login(payload: LoginIn):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    token = create_token(user["id"], email)
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
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    return {"ok": True}


# ---------- Password recovery via security question (no external integration) ----------
class SecurityQuestionIn(BaseModel):
    question: str
    answer: str


class ResetPasswordSecurityIn(BaseModel):
    email: EmailStr
    answer: str
    new_password: str


@api.post("/auth/security-question")
async def set_security_question(payload: SecurityQuestionIn, user=Depends(get_current_user)):
    q = payload.question.strip()
    a = payload.answer.strip().lower()
    if not q or not a:
        raise HTTPException(400, "Pergunta e resposta são obrigatórias")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"security_question": q, "security_answer_hash": hash_password(a)}},
    )
    return {"ok": True}


@api.get("/auth/security-question")
async def get_security_question(email: str):
    u = await db.users.find_one({"email": email.lower()}, {"_id": 0})
    if not u or not u.get("security_answer_hash"):
        return {"question": None}
    return {"question": u.get("security_question")}


@api.post("/auth/reset-password-security")
async def reset_password_security(payload: ResetPasswordSecurityIn):
    u = await db.users.find_one({"email": payload.email.lower()})
    if not u or not u.get("security_answer_hash"):
        raise HTTPException(400, "Recuperação por pergunta não disponível para esta conta")
    if not verify_password(payload.answer.strip().lower(), u["security_answer_hash"]):
        raise HTTPException(400, "Resposta de segurança incorreta")
    if len(payload.new_password) < 4:
        raise HTTPException(400, "A senha deve ter ao menos 4 caracteres")
    await db.users.update_one(
        {"id": u["id"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    return {"ok": True}


@api.get("/users/search")
async def search_users(email: str, user=Depends(get_current_user)):
    u = await db.users.find_one({"email": email.lower()}, {"_id": 0, "password_hash": 0})
    if not u:
        return None
    return public_user(u)


# ---------- Categories ----------
@api.get("/categories")
async def list_categories(user=Depends(get_current_user)):
    return await db.categories.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)


@api.post("/categories")
async def create_category(payload: CategoryIn, user=Depends(get_current_user)):
    doc = {"id": new_id(), "user_id": user["id"], **payload.model_dump(),
           "is_default": False, "created_at": now_iso()}
    await db.categories.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/categories/{cid}")
async def update_category(cid: str, payload: CategoryIn, user=Depends(get_current_user)):
    res = await db.categories.update_one(
        {"id": cid, "user_id": user["id"]},
        {"$set": payload.model_dump()},
    )
    if not res.matched_count:
        raise HTTPException(404, "Não encontrada")
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


@api.get("/accounts")
async def list_accounts(user=Depends(get_current_user)):
    accounts = await db.accounts.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)
    txs = await db.transactions.find(
        {"user_id": user["id"], "status": "paid"}, {"_id": 0},
    ).to_list(20000)
    base_currency = normalize_currency(user.get("currency"))
    for a in accounts:
        a["currency"] = normalize_currency(a.get("currency"), base_currency)
    bal = {a["id"]: a.get("initial_balance", 0.0) for a in accounts}
    for t in txs:
        if t["type"] == "income" and t.get("account_id") in bal:
            bal[t["account_id"]] += t["amount"]
        elif t["type"] == "expense" and t.get("account_id") in bal:
            bal[t["account_id"]] -= t["amount"]
        elif t["type"] == "transfer":
            if t.get("from_account_id") in bal:
                bal[t["from_account_id"]] -= t["amount"]
            if t.get("to_account_id") in bal:
                bal[t["to_account_id"]] += t.get("target_amount", t["amount"])
    # Paid installments reduce the linked wallet balance (payment confirmed).
    # Pending parcels do NOT affect balance until marked as paid.
    paid_inst = await db.installments.find(
        {"user_id": user["id"], "status": "paid"},
        {"_id": 0, "purchase_id": 1, "amount": 1},
    ).to_list(5000)
    if paid_inst:
        pur_ids = list({i["purchase_id"] for i in paid_inst})
        purchases = await db.installment_purchases.find(
            {"id": {"$in": pur_ids}}, {"_id": 0, "id": 1, "account_id": 1}).to_list(500)
        acc_by_pur = {p["id"]: p.get("account_id") for p in purchases}
        for i in paid_inst:
            aid = acc_by_pur.get(i["purchase_id"])
            if aid in bal:
                bal[aid] -= i["amount"]
    for a in accounts:
        a["balance"] = round(bal.get(a["id"], 0.0), 2)
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


@api.post("/accounts")
async def create_account(payload: AccountIn, user=Depends(get_current_user)):
    currency = normalize_currency(payload.currency, user.get("currency", "EUR"))
    meta = await monetary_metadata(currency, user.get("currency", "EUR"))
    values = payload.model_dump(exclude={"currency"})
    doc = {"id": new_id(), "user_id": user["id"], **values, **meta,
           "created_at": now_iso()}
    await db.accounts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/accounts/{aid}")
async def update_account(aid: str, payload: AccountIn, user=Depends(get_current_user)):
    current = await db.accounts.find_one({"id": aid, "user_id": user["id"]}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Carteira não encontrada")
    current_currency = normalize_currency(current.get("currency"), user.get("currency", "EUR"))
    new_currency = normalize_currency(payload.currency, current_currency)
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
    include_carryover: bool = True,
):
    horizon = month_end_date(year, month) if (year and month) else None
    await materialize_recurrences(user["id"], horizon)

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
    if account_id:
        q["$or"] = [
            {"account_id": account_id},
            {"from_account_id": account_id},
            {"to_account_id": account_id},
        ]
    rows = await db.transactions.find(q, {"_id": 0}).to_list(2000)
    for r in rows:
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
        if account_id:
            overdue_q["$or"] = [
                {"account_id": account_id},
                {"from_account_id": account_id},
                {"to_account_id": account_id},
            ]
        overdue_rows = await db.transactions.find(overdue_q, {"_id": 0}).to_list(2000)
        existing_ids = {r["id"] for r in rows}
        for r in overdue_rows:
            if r["id"] in existing_ids:
                continue
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
                    "currency": pur.get("currency"),
                    "exchange_rates": pur.get("exchange_rates"),
                    "base_currency_at_creation": pur.get("base_currency_at_creation"),
                    "exchange_rate_to_base": pur.get("exchange_rate_to_base"),
                })

    currencies = await account_currency_map(user)
    base_currency = normalize_currency(user.get("currency"))
    for row in rows:
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

    currency = normalize_currency(payload.currency, currencies.get(payload.account_id, base_currency))
    manual_rate = payload.exchange_rate if payload.rate_source != "automatic" else None
    meta = await monetary_metadata(currency, base_currency, payload.date, manual_rate)
    if payload.rate_source:
        meta["rate_source"] = payload.rate_source
    return {
        **values,
        **meta,
        "base_amount": round(payload.amount * meta["exchange_rate_to_base"], 2),
    }


@api.post("/transactions")
async def create_transaction(payload: TransactionIn, user=Depends(get_current_user)):
    await _validate_transfer(payload, user)
    values = await transaction_values(payload, user)
    doc = {"id": new_id(), "user_id": user["id"], **values,
           "created_at": now_iso()}
    await db.transactions.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _validate_transfer(payload: TransactionIn, user):
    if payload.type != "transfer":
        return
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
    values = await transaction_values(payload, user)
    res = await db.transactions.update_one(
        {"id": tid, "user_id": user["id"]},
        {"$set": values},
    )
    if not res.matched_count:
        raise HTTPException(404, "Não encontrado")
    return {"ok": True}


@api.delete("/transactions/{tid}")
async def delete_transaction(tid: str, user=Depends(get_current_user)):
    tx = await db.transactions.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
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
    for tx in txs:
        if tx.get("receipt"):
            await db.files.update_one(
                {"id": tx["receipt"]["file_id"]}, {"$set": {"is_deleted": True}})
    res = await db.transactions.delete_many(
        {"id": {"$in": body.ids}, "user_id": user["id"]})
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
    return await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})


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
                    "category_id": r.get("category_id"), "account_id": r.get("account_id"),
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
async def list_recurrences(user=Depends(get_current_user)):
    return await db.recurrences.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.post("/recurrences")
async def create_recurrence(payload: RecurrenceIn, user=Depends(get_current_user)):
    currencies = await account_currency_map(user)
    base_currency = normalize_currency(user.get("currency"))
    currency = normalize_currency(payload.currency, currencies.get(payload.account_id, base_currency))
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


@api.put("/recurrences/{rid}")
async def update_recurrence(rid: str, payload: RecurrenceIn, user=Depends(get_current_user)):
    currencies = await account_currency_map(user)
    base_currency = normalize_currency(user.get("currency"))
    currency = normalize_currency(payload.currency, currencies.get(payload.account_id, base_currency))
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
            "category_id": payload.category_id, "account_id": payload.account_id,
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
async def list_purchases(user=Depends(get_current_user)):
    purchases = await db.installment_purchases.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).to_list(500)
    for p in purchases:
        p["installments_list"] = await db.installments.find(
            {"purchase_id": p["id"]}, {"_id": 0}
        ).sort("number", 1).to_list(200)
    return purchases


@api.post("/installments/purchases")
async def create_purchase(payload: InstallmentPurchaseIn, user=Depends(get_current_user)):
    pid = new_id()
    per = round(payload.total_amount / payload.installments, 2)
    base_date = datetime.fromisoformat(payload.first_date)
    currencies = await account_currency_map(user)
    base_currency = normalize_currency(user.get("currency"))
    currency = normalize_currency(payload.currency, currencies.get(payload.account_id, base_currency))
    meta = await monetary_metadata(currency, base_currency, payload.first_date, payload.exchange_rate)
    values = payload.model_dump(exclude={"currency", "exchange_rate"})
    purchase = {
        "id": pid, "user_id": user["id"], **values, **meta,
        "created_at": now_iso(),
    }
    await db.installment_purchases.insert_one(purchase)
    inst_docs = []
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
        for i in inst_docs:
            i.pop("_id", None)
    purchase["installments_list"] = inst_docs
    purchase.pop("_id", None)
    return purchase


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
async def list_receivables(user=Depends(get_current_user)):
    return await db.receivables.find({"user_id": user["id"]}, {"_id": 0}).sort("due_date", 1).to_list(500)


@api.post("/receivables")
async def create_receivable(payload: ReceivableIn, user=Depends(get_current_user)):
    currencies = await account_currency_map(user)
    base_currency = normalize_currency(user.get("currency"))
    currency = normalize_currency(payload.currency, currencies.get(payload.account_id, base_currency))
    meta = await monetary_metadata(currency, base_currency, payload.due_date, payload.exchange_rate)
    values = payload.model_dump(exclude={"currency", "exchange_rate"})
    doc = {"id": new_id(), "user_id": user["id"], **values, **meta,
           "status": "pending", "received_at": None, "created_at": now_iso()}
    await db.receivables.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/receivables/{rid}")
async def update_receivable(rid: str, payload: ReceivableIn, user=Depends(get_current_user)):
    currencies = await account_currency_map(user)
    base_currency = normalize_currency(user.get("currency"))
    currency = normalize_currency(payload.currency, currencies.get(payload.account_id, base_currency))
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
@api.get("/groups")
async def list_groups(user=Depends(get_current_user)):
    groups = await db.groups.find(
        {"member_ids": user["id"]}, {"_id": 0}
    ).to_list(200)
    for g in groups:
        members = await db.users.find(
            {"id": {"$in": g.get("member_ids", [])}}, {"_id": 0, "password_hash": 0}
        ).to_list(50)
        g["members"] = [public_user(m) for m in members]
    return groups


@api.post("/groups")
async def create_group(payload: GroupIn, user=Depends(get_current_user)):
    member_ids = [user["id"]]
    for em in payload.member_emails:
        u = await db.users.find_one({"email": em.lower()})
        if u and u["id"] not in member_ids:
            member_ids.append(u["id"])
    doc = {
        "id": new_id(), "name": payload.name, "description": payload.description,
        "creator_id": user["id"], "member_ids": member_ids, "created_at": now_iso(),
    }
    await db.groups.insert_one(doc)
    doc.pop("_id", None)
    for mid in member_ids:
        if mid != user["id"]:
            await push_notification(
                mid, "group_added", "Adicionado a um grupo",
                f"{user['name']} adicionou você ao grupo '{payload.name}'.",
                "/grupos", {"group_id": doc["id"]},
            )
    return doc


@api.post("/groups/{gid}/members")
async def add_group_member(gid: str, body: dict, user=Depends(get_current_user)):
    email = body.get("email", "").lower()
    group = await db.groups.find_one({"id": gid, "member_ids": user["id"]})
    if not group:
        raise HTTPException(404, "Grupo não encontrado")
    u = await db.users.find_one({"email": email})
    if not u:
        raise HTTPException(404, "Usuário não encontrado")
    await db.groups.update_one({"id": gid}, {"$addToSet": {"member_ids": u["id"]}})
    await push_notification(
        u["id"], "group_added", "Adicionado a um grupo",
        f"{user['name']} adicionou você ao grupo '{group['name']}'.",
        "/grupos", {"group_id": gid},
    )
    return {"ok": True}


class GroupUpdateIn(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


@api.put("/groups/{gid}")
async def update_group(gid: str, payload: GroupUpdateIn, user=Depends(get_current_user)):
    g = await db.groups.find_one({"id": gid})
    if not g or g.get("creator_id") != user["id"]:
        raise HTTPException(403, "Apenas o criador pode editar")
    upd = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if upd:
        await db.groups.update_one({"id": gid}, {"$set": upd})
    return {"ok": True}


@api.delete("/groups/{gid}/members/{uid}")
async def remove_group_member(gid: str, uid: str, user=Depends(get_current_user)):
    g = await db.groups.find_one({"id": gid})
    if not g or g.get("creator_id") != user["id"]:
        raise HTTPException(403, "Apenas o criador pode remover membros")
    if uid == g["creator_id"]:
        raise HTTPException(400, "Não é possível remover o criador")
    await db.groups.update_one({"id": gid}, {"$pull": {"member_ids": uid}})
    return {"ok": True}


@api.delete("/groups/{gid}")
async def delete_group(gid: str, user=Depends(get_current_user)):
    g = await db.groups.find_one({"id": gid})
    if not g or g.get("creator_id") != user["id"]:
        raise HTTPException(403, "Sem permissão")
    await db.groups.delete_one({"id": gid})
    return {"ok": True}


# ---------- Shared Expenses ----------
def compute_splits(amount: float, split_type: str, participants: List[dict]) -> List[dict]:
    n = len(participants)
    out = []
    if split_type == "equal":
        per = round(amount / n, 2)
        for p in participants:
            out.append({"user_id": p["user_id"], "owed": per, "paid_back": False})
        # adjust rounding diff on last
        diff = round(amount - per * n, 2)
        if out and diff:
            out[-1]["owed"] = round(out[-1]["owed"] + diff, 2)
    elif split_type == "manual":
        for p in participants:
            out.append({"user_id": p["user_id"], "owed": float(p.get("amount") or 0), "paid_back": False})
    elif split_type == "percent":
        for p in participants:
            out.append({"user_id": p["user_id"],
                        "owed": round(amount * float(p.get("percent") or 0) / 100.0, 2),
                        "paid_back": False})
    return out


@api.get("/shared-expenses")
async def list_shared(user=Depends(get_current_user), group_id: Optional[str] = None):
    q = {"participant_ids": user["id"]}
    if group_id:
        q["group_id"] = group_id
    items = await db.shared_expenses.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    user_ids = set()
    for it in items:
        user_ids.add(it["payer_id"])
        user_ids.update(it["participant_ids"])
    users = await db.users.find({"id": {"$in": list(user_ids)}}, {"_id": 0, "password_hash": 0}).to_list(200)
    umap = {u["id"]: public_user(u) for u in users}
    for it in items:
        it["payer"] = umap.get(it["payer_id"])
        for p in it["participants"]:
            p["user"] = umap.get(p["user_id"])
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


@api.post("/shared-expenses")
async def create_shared(payload: SharedExpenseIn, user=Depends(get_current_user)):
    participants_in = [p.model_dump() for p in payload.participants]
    if not participants_in:
        raise HTTPException(400, "Adicione ao menos um participante")
    participant_ids = [p["user_id"] for p in participants_in]
    if user["id"] not in participant_ids and payload.payer_id != user["id"]:
        raise HTTPException(403, "Você precisa ser participante ou pagador")
    splits = compute_splits(payload.amount, payload.split_type, participants_in)
    currency = normalize_currency(payload.currency, user.get("currency", "EUR"))
    meta = await monetary_metadata(currency, user.get("currency", "EUR"), payload.date, payload.exchange_rate)
    doc = {
        "id": new_id(), "creator_id": user["id"],
        "title": payload.title, "amount": payload.amount, "date": payload.date,
        "category": payload.category, "payer_id": payload.payer_id,
        "split_type": payload.split_type, "group_id": payload.group_id,
        "notes": payload.notes,
        **meta,
        "participants": splits, "participant_ids": participant_ids,
        "status": "open", "created_at": now_iso(),
    }
    await db.shared_expenses.insert_one(doc)
    doc.pop("_id", None)

    # Notify all participants except the creator
    payer = await db.users.find_one({"id": payload.payer_id}, {"_id": 0})
    payer_name = payer["name"] if payer else "alguém"
    for p in splits:
        if p["user_id"] == user["id"]:
            continue
        is_payer = p["user_id"] == payload.payer_id
        msg = (f"{user['name']} adicionou você na despesa '{payload.title}' "
               f"({fmt_eur(payload.amount, user.get('currency', 'EUR'))})"
               + ("" if is_payer else f". Você deve {fmt_eur(p['owed'], user.get('currency', 'EUR'))} para {payer_name}."))
        await push_notification(
            p["user_id"], "shared_expense_added",
            "Nova despesa compartilhada", msg,
            "/despesas-compartilhadas", {"expense_id": doc["id"]},
        )
    return doc


def fmt_eur(v: float, currency: str = "EUR") -> str:
    symbol = {"EUR": "€", "BRL": "R$", "USD": "$", "CHF": "CHF"}.get(currency, currency)
    return f"{symbol} {v:.2f}"


@api.post("/shared-expenses/{sid}/settle/{user_id}")
async def settle_participant(sid: str, user_id: str, user=Depends(get_current_user)):
    se = await db.shared_expenses.find_one({"id": sid, "participant_ids": user["id"]})
    if not se:
        raise HTTPException(404, "Despesa não encontrada")
    parts = se["participants"]
    new_paid = False
    amount_paid = 0
    for p in parts:
        if p["user_id"] == user_id:
            new_paid = not p.get("paid_back", False)
            p["paid_back"] = new_paid
            amount_paid = p["owed"]
    if new_paid and user_id != se["payer_id"]:
        await db.settlement_history.insert_one({
            "id": new_id(), "expense_id": sid, "expense_title": se["title"],
            "debtor_id": user_id, "creditor_id": se["payer_id"],
            "amount": amount_paid, "paid_at": now_iso(),
        })
    all_paid = all(p.get("paid_back") or p["user_id"] == se["payer_id"] for p in parts)
    any_paid = any(p.get("paid_back") for p in parts)
    status = "finalized" if all_paid else ("partial" if any_paid else "open")
    await db.shared_expenses.update_one({"id": sid}, {"$set": {"participants": parts, "status": status}})
    # Notify the payer when someone marks as paid
    if new_paid and user_id != se["payer_id"]:
        debtor = await db.users.find_one({"id": user_id}, {"_id": 0})
        amount = next((p["owed"] for p in parts if p["user_id"] == user_id), 0)
        await push_notification(
            se["payer_id"], "settlement_paid",
            "Acerto recebido",
            f"{debtor['name'] if debtor else 'Alguém'} marcou {fmt_eur(amount)} como pago em '{se['title']}'.",
            "/acertos", {"expense_id": sid},
        )
    return {"ok": True, "status": status, "paid_back": new_paid}


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


@app.websocket("/api/ws/notifications")
async def ws_notifications(websocket: WebSocket):
    token = websocket.query_params.get("token")
    user_id = None
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            user_id = payload.get("sub")
        except Exception:
            user_id = None
    if not user_id:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    ws_manager.connect(user_id, websocket)
    try:
        unread = await db.notifications.count_documents({"user_id": user_id, "read": False})
        await websocket.send_json({"event": "init", "unread": unread})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(user_id, websocket)
    except Exception:
        ws_manager.disconnect(user_id, websocket)


@api.put("/shared-expenses/{sid}")
async def update_shared(sid: str, payload: SharedExpenseIn, user=Depends(get_current_user)):
    se = await db.shared_expenses.find_one({"id": sid})
    if not se:
        raise HTTPException(404, "Não encontrado")
    if se["creator_id"] != user["id"]:
        raise HTTPException(403, "Apenas o criador pode editar")
    participants_in = [p.model_dump() for p in payload.participants]
    if not participants_in:
        raise HTTPException(400, "Adicione ao menos um participante")
    participant_ids = [p["user_id"] for p in participants_in]
    splits = compute_splits(payload.amount, payload.split_type, participants_in)
    currency = normalize_currency(payload.currency, se.get("currency", user.get("currency", "EUR")))
    meta = await monetary_metadata(currency, user.get("currency", "EUR"), payload.date, payload.exchange_rate)
    # preserve paid_back state
    existing_paid = {p["user_id"]: p.get("paid_back", False) for p in se.get("participants", [])}
    for p in splits:
        p["paid_back"] = existing_paid.get(p["user_id"], False)
    await db.shared_expenses.update_one(
        {"id": sid},
        {"$set": {
            "title": payload.title, "amount": payload.amount, "date": payload.date,
            "category": payload.category, "payer_id": payload.payer_id,
            "split_type": payload.split_type, "group_id": payload.group_id,
            "notes": payload.notes, "participants": splits,
            "participant_ids": participant_ids,
            **meta,
        }},
    )
    return {"ok": True}


@api.delete("/shared-expenses/{sid}")
async def delete_shared(sid: str, user=Depends(get_current_user)):
    se = await db.shared_expenses.find_one({"id": sid})
    if not se:
        raise HTTPException(404, "Não encontrado")
    if se["creator_id"] != user["id"] and se["payer_id"] != user["id"]:
        raise HTTPException(403, "Apenas o criador ou o pagador pode excluir")
    await db.shared_expenses.delete_one({"id": sid})
    return {"ok": True}


# ---------- Settlements ----------
@api.post("/settlements/settle-between/{other_id}")
async def settle_between(other_id: str, user=Depends(get_current_user)):
    """Mark as paid_back all open shared-expense debts between current user and other_id."""
    exps = await db.shared_expenses.find(
        {"participant_ids": {"$all": [user["id"], other_id]}}, {"_id": 0}
    ).to_list(1000)
    touched = 0
    for e in exps:
        changed = False
        for p in e["participants"]:
            if p.get("paid_back"):
                continue
            payer = e["payer_id"]
            # case A: other_id is payer, user is debtor
            if payer == other_id and p["user_id"] == user["id"]:
                p["paid_back"] = True
                changed = True
            # case B: user is payer, other_id is debtor
            elif payer == user["id"] and p["user_id"] == other_id:
                p["paid_back"] = True
                changed = True
        if changed:
            all_paid = all(p.get("paid_back") or p["user_id"] == e["payer_id"] for p in e["participants"])
            any_paid = any(p.get("paid_back") for p in e["participants"])
            status = "finalized" if all_paid else ("partial" if any_paid else "open")
            await db.shared_expenses.update_one(
                {"id": e["id"]}, {"$set": {"participants": e["participants"], "status": status}}
            )
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
    exps = await db.shared_expenses.find(
        {"participant_ids": {"$all": [user["id"], debtor_id]}, "payer_id": user["id"]},
        {"_id": 0},
    ).to_list(500)
    total = 0.0
    base_currency = normalize_currency(user.get("currency"))
    for e in exps:
        for p in e["participants"]:
            if p["user_id"] == debtor_id and not p.get("paid_back"):
                total += amount_in_currency({**e, "amount": p["owed"]}, base_currency)
    if total <= 0:
        raise HTTPException(400, "Sem dívida pendente")
    await push_notification(
        debtor_id, "nudge", "Lembrete de pagamento",
        f"{user['name']} está lembrando que você deve {fmt_eur(total)} em despesas compartilhadas.",
        "/acertos", {"from": user["id"]},
    )
    return {"ok": True, "amount": round(total, 2)}


@api.get("/settlements/history")
async def settlement_history(user=Depends(get_current_user), limit: int = 100):
    items = await db.settlement_history.find(
        {"$or": [{"debtor_id": user["id"]}, {"creditor_id": user["id"]}]}, {"_id": 0},
    ).sort("paid_at", -1).limit(limit).to_list(limit)
    uids = set()
    for it in items:
        uids.update([it["debtor_id"], it["creditor_id"]])
    users = await db.users.find({"id": {"$in": list(uids)}}, {"_id": 0, "password_hash": 0}).to_list(200)
    umap = {u["id"]: public_user(u) for u in users}
    for it in items:
        it["debtor"] = umap.get(it["debtor_id"])
        it["creditor"] = umap.get(it["creditor_id"])
    return items


@api.get("/settlements")
async def list_settlements(user=Depends(get_current_user)):
    """Compute simplified who-owes-whom from open shared expenses involving the user.
    Uses a greedy min-cash-flow algorithm: nets each user's balance then matches
    biggest creditor to biggest debtor iteratively."""
    exps = await db.shared_expenses.find(
        {"participant_ids": user["id"]}, {"_id": 0}
    ).to_list(1000)
    user_ids = set()
    raw_rows = []
    # Net balance per user (across ALL pending shared expenses the user sees)
    net = defaultdict(float)
    base_currency = normalize_currency(user.get("currency"))
    for e in exps:
        payer = e["payer_id"]
        for p in e["participants"]:
            if p["user_id"] == payer or p.get("paid_back"):
                continue
            owed = amount_in_currency({**e, "amount": p["owed"]}, base_currency)
            net[payer] += owed
            net[p["user_id"]] -= owed
            user_ids.update([payer, p["user_id"]])
            # keep raw row for "lançamentos pendentes" table
            if user["id"] in (p["user_id"], payer):
                raw_rows.append({
                    "expense_id": e["id"], "title": e["title"],
                    "debtor_id": p["user_id"], "creditor_id": payer,
                    "amount": round(owed, 2), "date": e["date"],
                    "currency": base_currency,
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
        if user["id"] in (d_id, c_id):
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

    users = await db.users.find(
        {"id": {"$in": list(user_ids)}}, {"_id": 0, "password_hash": 0}
    ).to_list(200)
    umap = {u["id"]: public_user(u) for u in users}
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
            if p.get("paid_back"):
                continue
            if p["user_id"] == payer:
                continue
            if payer == user["id"]:
                # I paid -> they owe me
                shared_receivable += converted({**se, "amount": p["owed"]})
            elif p["user_id"] == user["id"]:
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


@api.get("/insights")
async def insights(user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    cur_inc, cur_exp = await _month_net(user, now.year, now.month)
    pmm, pyy = now.month - 1, now.year
    if pmm <= 0:
        pmm, pyy = 12, now.year - 1
    prev_inc, prev_exp = await _month_net(user, pyy, pmm)

    out = []
    # Savings rate
    if cur_inc > 0:
        rate = round((cur_inc - cur_exp) / cur_inc * 100, 1)
        if rate >= 0:
            out.append({"type": "savings", "severity": "good",
                        "title": "Taxa de poupança",
                        "message": f"Você guardou {rate}% da sua receita este mês ({fmt_eur(cur_inc - cur_exp, user.get('currency','EUR'))})."})
        else:
            out.append({"type": "savings", "severity": "warning",
                        "title": "Gastos acima da receita",
                        "message": f"Suas despesas superaram a receita em {fmt_eur(cur_exp - cur_inc, user.get('currency','EUR'))} este mês."})
    # Expense trend vs last month
    if prev_exp > 0:
        diff = cur_exp - prev_exp
        pct = round(abs(diff) / prev_exp * 100, 1)
        if diff > 0:
            out.append({"type": "trend", "severity": "warning",
                        "title": "Despesas em alta",
                        "message": f"Seus gastos subiram {pct}% em relação a {pyy}-{pmm:02d}."})
        elif diff < 0:
            out.append({"type": "trend", "severity": "good",
                        "title": "Despesas em queda",
                        "message": f"Você gastou {pct}% menos que no mês passado. Continue assim!"})
    # Top category this month
    start, end = month_range(now.year, now.month)
    txs = await db.transactions.find(
        {"user_id": user["id"], "type": "expense", "date": {"$gte": start[:10], "$lt": end[:10]},
         "status": {"$ne": "cancelled"}}, {"_id": 0},
    ).to_list(5000)
    base_currency = normalize_currency(user.get("currency"))
    currencies = await account_currency_map(user)
    for tx in txs:
        if not tx.get("currency"):
            tx["currency"] = currencies.get(tx.get("account_id"), base_currency)
    by_cat = defaultdict(float)
    for t in txs:
        if t.get("category_id"):
            by_cat[t["category_id"]] += amount_in_currency(t, base_currency)
    if by_cat:
        top_id, top_val = max(by_cat.items(), key=lambda x: x[1])
        cat = await db.categories.find_one({"id": top_id}, {"_id": 0, "name": 1})
        share = round(top_val / cur_exp * 100, 1) if cur_exp else 0
        out.append({"type": "category", "severity": "info",
                    "title": "Maior categoria de gasto",
                    "message": f"'{cat['name'] if cat else 'Outros'}' representa {share}% dos seus gastos ({fmt_eur(top_val, user.get('currency','EUR'))})."})
    # Pending payables
    pend = sum(amount_in_currency(t, base_currency) for t in txs if t["status"] == "pending")
    if pend > 0:
        out.append({"type": "pending", "severity": "warning",
                    "title": "Contas pendentes",
                    "message": f"Você tem {fmt_eur(pend, user.get('currency','EUR'))} em despesas pendentes este mês."})
    if not out:
        out.append({"type": "empty", "severity": "info", "title": "Sem dados suficientes",
                    "message": "Cadastre receitas e despesas para receber insights personalizados."})
    return out


# ---------- Financial Goals ----------
class GoalIn(BaseModel):
    title: str
    target_amount: float
    current_amount: float = 0.0
    deadline: Optional[str] = None
    color: str = "#1E3F33"
    account_id: Optional[str] = None


class ContributeIn(BaseModel):
    amount: float
    from_account_id: Optional[str] = None


@api.get("/goals")
async def list_goals(user=Depends(get_current_user)):
    return await db.goals.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.post("/goals")
async def create_goal(payload: GoalIn, user=Depends(get_current_user)):
    doc = {"id": new_id(), "user_id": user["id"], **payload.model_dump(),
           "created_at": now_iso()}
    await db.goals.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/goals/{gid}")
async def update_goal(gid: str, payload: GoalIn, user=Depends(get_current_user)):
    res = await db.goals.update_one(
        {"id": gid, "user_id": user["id"]}, {"$set": payload.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Meta não encontrada")
    return await db.goals.find_one({"id": gid}, {"_id": 0})


@api.post("/goals/{gid}/contribute")
async def contribute_goal(gid: str, body: ContributeIn, user=Depends(get_current_user)):
    if body.amount <= 0:
        raise HTTPException(400, "O valor do aporte deve ser maior que zero")
    goal = await db.goals.find_one({"id": gid, "user_id": user["id"]}, {"_id": 0})
    if not goal:
        raise HTTPException(404, "Meta não encontrada")

    # Optionally create a real transaction so balances stay coherent
    if body.from_account_id:
        src = await db.accounts.find_one({"id": body.from_account_id, "user_id": user["id"]}, {"_id": 0})
        if not src:
            raise HTTPException(404, "Conta de origem não encontrada")
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
        await db.transactions.insert_one({
            "id": new_id(), "user_id": user["id"], "date": now_iso()[:10],
            "amount": body.amount, "payment_method": None,
            "description": f"Aporte: {goal['title']}", "notes": "(aporte meta)",
            "status": "paid", "goal_id": gid, "created_at": now_iso(), **tx,
        })

    new_amt = round(goal.get("current_amount", 0) + body.amount, 2)
    await db.goals.update_one({"id": gid}, {"$set": {"current_amount": new_amt}})
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
    current = goal.get("current_amount", 0)
    if body.amount > current:
        raise HTTPException(400, "Valor maior que o saldo da meta")

    # Optionally return the money to an account via a real transaction
    if body.to_account_id:
        dest = await db.accounts.find_one({"id": body.to_account_id, "user_id": user["id"]}, {"_id": 0})
        if not dest:
            raise HTTPException(404, "Conta de destino não encontrada")
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
        await db.transactions.insert_one({
            "id": new_id(), "user_id": user["id"], "date": now_iso()[:10],
            "amount": body.amount, "payment_method": None,
            "description": f"Resgate: {goal['title']}", "notes": "(resgate meta)",
            "status": "paid", "goal_id": gid, "created_at": now_iso(), **tx,
        })

    new_amt = round(current - body.amount, 2)
    await db.goals.update_one({"id": gid}, {"$set": {"current_amount": new_amt}})
    goal["current_amount"] = new_amt
    return goal


@api.delete("/goals/{gid}")
async def delete_goal(gid: str, user=Depends(get_current_user)):
    await db.goals.delete_one({"id": gid, "user_id": user["id"]})
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
    await db.transactions.create_index([("user_id", 1), ("date", -1)])
    await db.shared_expenses.create_index("participant_ids")
    await db.groups.create_index("member_ids")
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])

    # Backfill: garantir categorias padrão de receita para usuários existentes
    income_defaults = [c for c in DEFAULT_CATEGORIES if c[3] == "income"]
    async for u in db.users.find({}, {"id": 1}):
        uid = u["id"]
        existing_names = set()
        async for c in db.categories.find({"user_id": uid, "kind": "income"}, {"name": 1}):
            existing_names.add(c["name"])
        for name, icon, color, kind in income_defaults:
            if name in existing_names:
                continue
            await db.categories.insert_one({
                "id": new_id(), "user_id": uid, "name": name,
                "icon": icon, "color": color, "kind": kind,
                "is_default": True, "created_at": now_iso(),
            })

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
