"""Bank statement import: preview, commit, undo and categorisation rules."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
from typing import Callable, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from services.statement_import.parser import (
    MAX_ROWS,
    MappingRequired,
    StatementParseError,
    description_key,
    normalize_text,
    parse_statement,
    row_fingerprints,
)


MAX_CONTENT_CHARS = 2_000_000
MAX_RULES = 200
HISTORY_SAMPLE = 3000


class ColumnMapping(BaseModel):
    date: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = Field(default=None, max_length=120)
    amount: Optional[str] = Field(default=None, max_length=120)
    debit: Optional[str] = Field(default=None, max_length=120)
    credit: Optional[str] = Field(default=None, max_length=120)


class PreviewIn(BaseModel):
    account_id: str = Field(min_length=1, max_length=120)
    filename: str = Field(default="", max_length=200)
    content: str = Field(min_length=1, max_length=MAX_CONTENT_CHARS)
    mapping: Optional[ColumnMapping] = None


class CommitRow(BaseModel):
    row_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    description: str = Field(min_length=1, max_length=200)
    amount: float = Field(gt=0)
    type: Literal["income", "expense"]
    category_id: Optional[str] = Field(default=None, max_length=120)


class CommitIn(BaseModel):
    account_id: str = Field(min_length=1, max_length=120)
    rows: List[CommitRow] = Field(min_length=1, max_length=MAX_ROWS)


class RuleIn(BaseModel):
    pattern: str = Field(min_length=2, max_length=100)
    category_id: str = Field(min_length=1, max_length=120)
    type: Optional[Literal["income", "expense"]] = None


def _category_fits(category: dict, tx_type: str) -> bool:
    return category.get("kind", "expense") in (tx_type, "both")


def suggest_category(
    description: str,
    tx_type: str,
    rules: List[dict],
    history: Dict[tuple, Counter],
    categories: Dict[str, dict],
):
    """Explicit rules win (longest match first); otherwise learn from history."""
    text = normalize_text(description)
    matching = [
        rule for rule in rules
        if rule.get("pattern_key") and rule["pattern_key"] in text
        and rule.get("type") in (None, tx_type)
        and rule.get("category_id") in categories
        and _category_fits(categories[rule["category_id"]], tx_type)
    ]
    if matching:
        best = max(matching, key=lambda rule: len(rule["pattern_key"]))
        return best["category_id"], "rule"
    counts = history.get((tx_type, description_key(description)))
    if counts:
        for category_id, _ in counts.most_common():
            if category_id in categories and _category_fits(categories[category_id], tx_type):
                return category_id, "history"
    return None, None


def create_statement_import_router(
    *,
    db,
    get_current_user: Callable,
    transaction_values: Callable,
    transaction_model: type,
    new_id: Callable[[], str],
    now_iso: Callable[[], str],
) -> APIRouter:
    router = APIRouter(prefix="/api/statement-imports", tags=["statement-imports"])

    async def owned_account(account_id: str, user: dict) -> dict:
        account = await db.accounts.find_one(
            {"id": account_id, "user_id": user["id"]}, {"_id": 0}
        )
        if not account:
            raise HTTPException(404, "Carteira não encontrada")
        if account.get("archived"):
            raise HTTPException(400, "Não é possível importar para uma carteira arquivada")
        return account

    async def category_map(user: dict) -> Dict[str, dict]:
        categories = await db.categories.find(
            {"user_id": user["id"]}, {"_id": 0}
        ).to_list(1000)
        return {category["id"]: category for category in categories}

    @router.post("/preview")
    async def preview_statement(payload: PreviewIn, user=Depends(get_current_user)):
        account = await owned_account(payload.account_id, user)
        mapping = payload.mapping.model_dump() if payload.mapping else None
        try:
            statement = parse_statement(payload.content, payload.filename, mapping)
        except MappingRequired as error:
            raise HTTPException(422, {
                "code": "mapping_required",
                "message": str(error),
                "headers": error.headers,
            })
        except StatementParseError as error:
            raise HTTPException(422, str(error))

        fingerprints = row_fingerprints(account["id"], statement.rows)
        imported = {
            item["import_fingerprint"]
            async for item in db.transactions.find(
                {"user_id": user["id"], "import_fingerprint": {"$in": fingerprints}},
                {"_id": 0, "import_fingerprint": 1},
            )
        }

        dates = [row.date for row in statement.rows]
        manual = Counter()
        async for item in db.transactions.find(
            {
                "user_id": user["id"],
                "account_id": account["id"],
                "date": {"$gte": min(dates), "$lte": max(dates)},
                "import_fingerprint": {"$exists": False},
            },
            {"_id": 0, "date": 1, "type": 1, "amount": 1},
        ):
            manual[(item.get("date", "")[:10], item.get("type"), round(float(item.get("amount") or 0), 2))] += 1

        categories = await category_map(user)
        rules = await db.import_rules.find({"user_id": user["id"]}, {"_id": 0}).to_list(MAX_RULES)
        history: Dict[tuple, Counter] = defaultdict(Counter)
        async for item in db.transactions.find(
            {"user_id": user["id"], "category_id": {"$type": "string"}},
            {"_id": 0, "description": 1, "category_id": 1, "type": 1},
        ).sort("date", -1).limit(HISTORY_SAMPLE):
            key = description_key(item.get("description"))
            if key and item.get("type") in ("income", "expense"):
                history[(item["type"], key)][item["category_id"]] += 1

        rows = []
        for row, fingerprint in zip(statement.rows, fingerprints):
            tx_type = "income" if row.amount > 0 else "expense"
            amount = round(abs(row.amount), 2)
            if fingerprint in imported:
                status = "imported"
            elif manual[(row.date, tx_type, amount)] > 0:
                manual[(row.date, tx_type, amount)] -= 1
                status = "possible_duplicate"
            else:
                status = "new"
            category_id, category_source = suggest_category(
                row.description, tx_type, rules, history, categories
            )
            rows.append({
                "row_id": fingerprint,
                "date": row.date,
                "description": row.description,
                "amount": amount,
                "type": tx_type,
                "category_id": category_id,
                "category_source": category_source,
                "status": status,
            })

        account_currency = (account.get("currency") or user.get("currency") or "EUR").upper()
        return {
            "format": statement.format,
            "headers": statement.headers,
            "statement_currency": statement.currency,
            "account_currency": account_currency,
            "currency_mismatch": bool(
                statement.currency and statement.currency != account_currency
            ),
            "rows": rows,
            "summary": dict(Counter(row["status"] for row in rows)),
        }

    @router.post("/commit")
    async def commit_statement(payload: CommitIn, user=Depends(get_current_user)):
        account = await owned_account(payload.account_id, user)
        categories = await category_map(user)
        for row in payload.rows:
            try:
                date.fromisoformat(row.date)
            except ValueError:
                raise HTTPException(400, f"Data inválida: {row.date}")
            if row.category_id and (
                row.category_id not in categories
                or not _category_fits(categories[row.category_id], row.type)
            ):
                raise HTTPException(400, "Categoria inválida para o tipo do lançamento")

        requested = list(dict.fromkeys(row.row_id for row in payload.rows))
        already = {
            item["import_fingerprint"]
            async for item in db.transactions.find(
                {"user_id": user["id"], "import_fingerprint": {"$in": requested}},
                {"_id": 0, "import_fingerprint": 1},
            )
        }

        batch_id = new_id()
        created_at = now_iso()
        seen = set()
        documents = []
        for row in payload.rows:
            if row.row_id in already or row.row_id in seen:
                continue
            seen.add(row.row_id)
            values = await transaction_values(transaction_model(
                type=row.type,
                date=row.date,
                amount=round(row.amount, 2),
                category_id=row.category_id,
                account_id=account["id"],
                description=row.description,
                status="paid",
            ), user)
            documents.append({
                "id": new_id(),
                "user_id": user["id"],
                **values,
                "import_fingerprint": row.row_id,
                "import_batch_id": batch_id,
                "created_at": created_at,
            })

        inserted = 0
        if documents:
            try:
                result = await db.transactions.insert_many(documents, ordered=False)
                inserted = len(result.inserted_ids)
            except Exception as error:  # concurrent import hit the unique index
                details = getattr(error, "details", None) or {}
                if "nInserted" not in details:
                    raise
                inserted = details["nInserted"]

        return {
            "batch_id": batch_id if inserted else None,
            "imported": inserted,
            "skipped": len(payload.rows) - inserted,
        }

    @router.delete("/batches/{batch_id}")
    async def undo_import(batch_id: str, user=Depends(get_current_user)):
        result = await db.transactions.delete_many({
            "user_id": user["id"],
            "import_batch_id": batch_id,
        })
        return {"deleted": result.deleted_count}

    @router.get("/rules")
    async def list_rules(user=Depends(get_current_user)):
        rules = await db.import_rules.find(
            {"user_id": user["id"]}, {"_id": 0, "user_id": 0, "pattern_key": 0}
        ).to_list(MAX_RULES)
        return sorted(rules, key=lambda rule: normalize_text(rule.get("pattern")))

    @router.post("/rules")
    async def create_rule(payload: RuleIn, user=Depends(get_current_user)):
        pattern = " ".join(payload.pattern.split())
        pattern_key = normalize_text(pattern)
        if len(pattern_key) < 2:
            raise HTTPException(400, "O texto da regra é muito curto")
        categories = await category_map(user)
        category = categories.get(payload.category_id)
        if not category or (payload.type and not _category_fits(category, payload.type)):
            raise HTTPException(400, "Categoria inválida para a regra")
        if await db.import_rules.count_documents({"user_id": user["id"]}) >= MAX_RULES:
            raise HTTPException(400, f"Limite de {MAX_RULES} regras atingido")
        existing = await db.import_rules.find_one(
            {"user_id": user["id"], "pattern_key": pattern_key, "type": payload.type},
            {"_id": 0},
        )
        if existing:
            await db.import_rules.update_one(
                {"id": existing["id"], "user_id": user["id"]},
                {"$set": {"category_id": payload.category_id, "pattern": pattern}},
            )
            rule_id = existing["id"]
        else:
            rule_id = new_id()
            await db.import_rules.insert_one({
                "id": rule_id,
                "user_id": user["id"],
                "pattern": pattern,
                "pattern_key": pattern_key,
                "category_id": payload.category_id,
                "type": payload.type,
                "created_at": now_iso(),
            })
        return {"id": rule_id, "pattern": pattern, "category_id": payload.category_id, "type": payload.type}

    @router.delete("/rules/{rule_id}")
    async def delete_rule(rule_id: str, user=Depends(get_current_user)):
        result = await db.import_rules.delete_one({"id": rule_id, "user_id": user["id"]})
        if not result.deleted_count:
            raise HTTPException(404, "Regra não encontrada")
        return {"ok": True}

    return router
