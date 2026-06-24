from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
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

app = FastAPI(title="Controle Financeiro")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("finance")


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
    type: Literal["checking", "savings", "cash", "card", "other"] = "checking"
    initial_balance: float = 0.0


class TransactionIn(BaseModel):
    type: Literal["income", "expense", "transfer"]
    date: str  # ISO date
    amount: float
    category_id: Optional[str] = None
    account_id: Optional[str] = None
    payment_method: Optional[str] = None
    description: str = ""
    notes: str = ""
    status: Literal["paid", "pending", "cancelled"] = "paid"


class InstallmentPurchaseIn(BaseModel):
    description: str
    total_amount: float
    installments: int
    first_date: str  # ISO date
    category_id: Optional[str] = None
    payment_method: Optional[str] = None
    account_id: Optional[str] = None


class ReceivableIn(BaseModel):
    person: str
    amount: float
    due_date: str
    description: str = ""


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


# ---------- Defaults ----------
DEFAULT_CATEGORIES = [
    ("Moradia", "home", "#1E3F33"),
    ("Mercado", "shopping-cart", "#D96C5B"),
    ("Transporte", "car", "#E5A83B"),
    ("Saúde", "heart-pulse", "#D9453B"),
    ("Educação", "graduation-cap", "#3B82F6"),
    ("Lazer", "gamepad-2", "#7EA193"),
    ("Assinaturas", "repeat", "#C7BCA1"),
    ("Contas fixas", "file-text", "#2C5C4A"),
    ("Compras", "shopping-bag", "#D96C5B"),
    ("Viagem", "plane", "#E5A83B"),
    ("Outros", "more-horizontal", "#6B7068"),
]


async def seed_user_defaults(user_id: str):
    for name, icon, color in DEFAULT_CATEGORIES:
        await db.categories.insert_one({
            "id": new_id(), "user_id": user_id, "name": name,
            "icon": icon, "color": color, "kind": "expense",
            "is_default": True, "created_at": now_iso(),
        })
    await db.accounts.insert_one({
        "id": new_id(), "user_id": user_id, "name": "Conta Principal",
        "type": "checking", "initial_balance": 0.0, "created_at": now_iso(),
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
    }


# ---------- Auth ----------
@api.post("/auth/register")
async def register(payload: RegisterIn):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")
    uid = new_id()
    user = {
        "id": uid, "name": payload.name, "email": email,
        "password_hash": hash_password(payload.password),
        "currency": payload.currency, "avatar_color": user_color(payload.name),
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    await seed_user_defaults(uid)
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


@api.delete("/categories/{cid}")
async def delete_category(cid: str, user=Depends(get_current_user)):
    await db.categories.delete_one({"id": cid, "user_id": user["id"]})
    return {"ok": True}


# ---------- Accounts ----------
@api.get("/accounts")
async def list_accounts(user=Depends(get_current_user)):
    return await db.accounts.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)


@api.post("/accounts")
async def create_account(payload: AccountIn, user=Depends(get_current_user)):
    doc = {"id": new_id(), "user_id": user["id"], **payload.model_dump(),
           "created_at": now_iso()}
    await db.accounts.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------- Transactions ----------
@api.get("/transactions")
async def list_transactions(
    user=Depends(get_current_user),
    year: Optional[int] = None, month: Optional[int] = None,
    category_id: Optional[str] = None, status: Optional[str] = None,
    type: Optional[str] = None,
):
    q = {"user_id": user["id"]}
    if year and month:
        start, end = month_range(year, month)
        q["date"] = {"$gte": start[:10], "$lt": end[:10]}
    if category_id:
        q["category_id"] = category_id
    if status:
        q["status"] = status
    if type:
        q["type"] = type
    return await db.transactions.find(q, {"_id": 0}).sort("date", -1).to_list(2000)


@api.post("/transactions")
async def create_transaction(payload: TransactionIn, user=Depends(get_current_user)):
    doc = {"id": new_id(), "user_id": user["id"], **payload.model_dump(),
           "created_at": now_iso()}
    await db.transactions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/transactions/{tid}")
async def update_transaction(tid: str, payload: TransactionIn, user=Depends(get_current_user)):
    res = await db.transactions.update_one(
        {"id": tid, "user_id": user["id"]},
        {"$set": payload.model_dump()},
    )
    if not res.matched_count:
        raise HTTPException(404, "Não encontrado")
    return {"ok": True}


@api.delete("/transactions/{tid}")
async def delete_transaction(tid: str, user=Depends(get_current_user)):
    await db.transactions.delete_one({"id": tid, "user_id": user["id"]})
    return {"ok": True}


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
    purchase = {
        "id": pid, "user_id": user["id"], **payload.model_dump(),
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
    doc = {"id": new_id(), "user_id": user["id"], **payload.model_dump(),
           "status": "pending", "received_at": None, "created_at": now_iso()}
    await db.receivables.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.post("/receivables/{rid}/receive")
async def receive_receivable(rid: str, user=Depends(get_current_user)):
    r = await db.receivables.find_one({"id": rid, "user_id": user["id"]})
    if not r:
        raise HTTPException(404, "Não encontrado")
    new_status = "pending" if r["status"] == "received" else "received"
    await db.receivables.update_one(
        {"id": rid},
        {"$set": {"status": new_status, "received_at": now_iso() if new_status == "received" else None}},
    )
    return {"ok": True}


@api.delete("/receivables/{rid}")
async def delete_receivable(rid: str, user=Depends(get_current_user)):
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
    await db.notifications.insert_one({
        "id": new_id(), "user_id": user_id, "type": ntype,
        "title": title, "message": message, "link": link,
        "meta": meta or {}, "read": False, "created_at": now_iso(),
    })


@api.post("/shared-expenses")
async def create_shared(payload: SharedExpenseIn, user=Depends(get_current_user)):
    participants_in = [p.model_dump() for p in payload.participants]
    if not participants_in:
        raise HTTPException(400, "Adicione ao menos um participante")
    participant_ids = [p["user_id"] for p in participants_in]
    if user["id"] not in participant_ids and payload.payer_id != user["id"]:
        raise HTTPException(403, "Você precisa ser participante ou pagador")
    splits = compute_splits(payload.amount, payload.split_type, participants_in)
    doc = {
        "id": new_id(), "creator_id": user["id"],
        "title": payload.title, "amount": payload.amount, "date": payload.date,
        "category": payload.category, "payer_id": payload.payer_id,
        "split_type": payload.split_type, "group_id": payload.group_id,
        "notes": payload.notes,
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
    symbol = {"EUR": "€", "BRL": "R$", "USD": "$"}.get(currency, currency)
    return f"{symbol} {v:.2f}"


@api.post("/shared-expenses/{sid}/settle/{user_id}")
async def settle_participant(sid: str, user_id: str, user=Depends(get_current_user)):
    se = await db.shared_expenses.find_one({"id": sid, "participant_ids": user["id"]})
    if not se:
        raise HTTPException(404, "Despesa não encontrada")
    parts = se["participants"]
    new_paid = False
    for p in parts:
        if p["user_id"] == user_id:
            new_paid = not p.get("paid_back", False)
            p["paid_back"] = new_paid
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
    return {"ok": True, "status": status}


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
@api.get("/settlements")
async def list_settlements(user=Depends(get_current_user)):
    """Compute who owes whom from open shared expenses involving the user."""
    exps = await db.shared_expenses.find(
        {"participant_ids": user["id"]}, {"_id": 0}
    ).to_list(1000)
    user_ids = set()
    rows = []
    for e in exps:
        payer = e["payer_id"]
        for p in e["participants"]:
            if p["user_id"] == payer:
                continue
            if p.get("paid_back"):
                continue
            # only include rows where current user is debtor or creditor
            if user["id"] not in (p["user_id"], payer):
                continue
            rows.append({
                "expense_id": e["id"], "title": e["title"],
                "debtor_id": p["user_id"], "creditor_id": payer,
                "amount": p["owed"], "date": e["date"],
            })
            user_ids.update([p["user_id"], payer])
    users = await db.users.find({"id": {"$in": list(user_ids)}}, {"_id": 0, "password_hash": 0}).to_list(200)
    umap = {u["id"]: public_user(u) for u in users}
    for r in rows:
        r["debtor"] = umap.get(r["debtor_id"])
        r["creditor"] = umap.get(r["creditor_id"])
    # Aggregate summary per counterpart
    agg = defaultdict(float)
    for r in rows:
        if r["debtor_id"] == user["id"]:
            agg[r["creditor_id"]] -= r["amount"]
        else:
            agg[r["debtor_id"]] += r["amount"]
    summary = []
    for uid, val in agg.items():
        summary.append({
            "user": umap.get(uid),
            "net": round(val, 2),  # positive => they owe you; negative => you owe them
        })
    return {"rows": rows, "summary": summary}


# ---------- Dashboard / Reports ----------
@api.get("/dashboard")
async def dashboard(user=Depends(get_current_user), year: Optional[int] = None, month: Optional[int] = None):
    now = datetime.now(timezone.utc)
    y = year or now.year
    m = month or now.month
    start, end = month_range(y, m)

    txs = await db.transactions.find(
        {"user_id": user["id"], "date": {"$gte": start[:10], "$lt": end[:10]},
         "status": {"$ne": "cancelled"}},
        {"_id": 0},
    ).to_list(5000)

    income = sum(t["amount"] for t in txs if t["type"] == "income")
    expense = sum(t["amount"] for t in txs if t["type"] == "expense")
    pending_payable = sum(t["amount"] for t in txs if t["type"] == "expense" and t["status"] == "pending")

    # Categories breakdown
    cats = await db.categories.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)
    cmap = {c["id"]: c for c in cats}
    by_cat = defaultdict(float)
    for t in txs:
        if t["type"] == "expense" and t.get("category_id"):
            by_cat[t["category_id"]] += t["amount"]
    cat_breakdown = [
        {"category": cmap.get(cid, {}).get("name", "Outros"),
         "color": cmap.get(cid, {}).get("color", "#6B7068"),
         "amount": round(v, 2)}
        for cid, v in sorted(by_cat.items(), key=lambda x: -x[1])
    ]

    # Receivables pending
    rec_pending = await db.receivables.find(
        {"user_id": user["id"], "status": "pending"}, {"_id": 0}
    ).to_list(200)
    receivable_total = sum(r["amount"] for r in rec_pending)

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
                shared_receivable += p["owed"]
            elif p["user_id"] == user["id"]:
                # I owe the payer
                shared_payable += p["owed"]
    receivable_total += shared_receivable
    pending_payable += shared_payable

    # Future installments
    inst_future = await db.installments.find(
        {"user_id": user["id"], "status": "pending", "due_date": {"$gte": now.date().isoformat()}},
        {"_id": 0},
    ).to_list(500)
    future_installments_total = sum(i["amount"] for i in inst_future)

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
        inc = sum(t["amount"] for t in mt if t["type"] == "income")
        exp = sum(t["amount"] for t in mt if t["type"] == "expense")
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

    return {
        "period": {"year": y, "month": m},
        "income": round(income, 2),
        "expense": round(expense, 2),
        "balance": round(income - expense, 2),
        "pending_payable": round(pending_payable, 2),
        "receivable_total": round(receivable_total, 2),
        "shared_receivable": round(shared_receivable, 2),
        "shared_payable": round(shared_payable, 2),
        "future_installments_total": round(future_installments_total, 2),
        "category_breakdown": cat_breakdown,
        "evolution": evolution,
        "budget": budget,
    }


@api.get("/reports/annual")
async def annual_report(year: int, user=Depends(get_current_user)):
    months = []
    for m in range(1, 13):
        s, e = month_range(year, m)
        txs = await db.transactions.find(
            {"user_id": user["id"], "date": {"$gte": s[:10], "$lt": e[:10]},
             "status": {"$ne": "cancelled"}},
            {"_id": 0},
        ).to_list(5000)
        inc = sum(t["amount"] for t in txs if t["type"] == "income")
        exp = sum(t["amount"] for t in txs if t["type"] == "expense")
        months.append({"month": m, "income": round(inc, 2),
                       "expense": round(exp, 2), "balance": round(inc - exp, 2)})
    return {"year": year, "months": months}


# ---------- Seed Demo ----------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.transactions.create_index([("user_id", 1), ("date", -1)])
    await db.shared_expenses.create_index("participant_ids")
    await db.groups.create_index("member_ids")
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
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
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
