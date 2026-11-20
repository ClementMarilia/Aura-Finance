"""Conta dividida entre o casal, com pagamento confirmado pelos dois lados.

Quem pagou registra a conta: a parte dele sai da carteira escolhida, e a parte
da outra pessoa vira um pendente a pagar, com a data combinada. Do lado de quem
pagou, a parte devida vira um pendente a receber, ligado ao pendente da outra
pessoa pelos mesmos campos ``counterparty_*`` do vínculo de contrapartes que já
existe no app. Assim valem as regras de pagamento já implementadas:

- quem deve informa "paguei" e fica aguardando a confirmação;
- quem recebeu confirma e dá baixa nos dois lados;
- quem recebeu também pode dar baixa direto, sem esperar a informação.

Fase 2 — limitações deliberadas:
- divisão sempre igual (50/50);
- moeda da carteira de quem pagou, sem conversão;
- cancelar ou editar uma conta dividida ainda não é suportado.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone
from typing import Awaitable, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

COUPLE_KIND = "couple"
SETTLEABLE_STATES = ("pending", "awaiting_confirmation")


class SharedExpenseIn(BaseModel):
    description: str = Field(min_length=1, max_length=120)
    amount: float = Field(gt=0, le=10_000_000)
    date: str = Field(description="Data em que a conta foi paga (YYYY-MM-DD)")
    due_date: str = Field(description="Data combinada para o pagamento da outra pessoa (YYYY-MM-DD)")
    account_id: str


def _parse_date(value: str, label: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise HTTPException(400, f"Data inválida em {label}")


def create_couple_shared_router(
    *,
    db,
    get_current_user,
    push_notification: Callable[..., Awaitable[None]],
    fmt_money: Callable[[float, str], str],
    normalize_currency: Callable[..., str],
    new_id: Callable[[], str],
    now_iso: Callable[[], str],
) -> APIRouter:
    router = APIRouter(prefix="/api/couple", tags=["couple"])

    async def _active_link_for(user_id: str) -> Optional[dict]:
        return await db.couple_links.find_one(
            {
                "status": "active",
                "$or": [{"requester_id": user_id}, {"partner_id": user_id}],
            },
            {"_id": 0},
        )

    async def _partner_user(link: dict, user_id: str) -> dict:
        other_id = link["partner_id"] if link["requester_id"] == user_id else link["requester_id"]
        partner = await db.users.find_one(
            {"id": other_id}, {"_id": 0, "password_hash": 0},
        )
        if not partner:
            raise HTTPException(409, "A outra pessoa não está disponível")
        return partner

    @router.post("/shared-expenses", status_code=201)
    async def create_shared_expense(payload: SharedExpenseIn, user=Depends(get_current_user)):
        link = await _active_link_for(user["id"])
        if not link:
            raise HTTPException(409, "Conecte-se a alguém como casal antes de dividir contas")

        paid_on = _parse_date(payload.date, "data do pagamento")
        due_on = _parse_date(payload.due_date, "data combinada")
        if due_on < paid_on:
            raise HTTPException(400, "A data combinada não pode ser anterior ao pagamento")

        account = await db.accounts.find_one(
            {"id": payload.account_id, "user_id": user["id"]}, {"_id": 0},
        )
        if not account:
            raise HTTPException(404, "Carteira não encontrada")
        currency = normalize_currency(account.get("currency"), user.get("currency", "EUR"))

        partner = await _partner_user(link, user["id"])
        total_cents = round(payload.amount * 100)
        partner_cents = total_cents // 2
        payer_cents = total_cents - partner_cents
        partner_share = partner_cents / 100
        payer_share = payer_cents / 100
        description = payload.description.strip()
        now = now_iso()

        payer_id, partner_id_tx, receivable_id, link_key = new_id(), new_id(), new_id(), new_id()
        payer_expense = {
            "id": payer_id,
            "user_id": user["id"],
            "type": "expense",
            "date": paid_on,
            "amount": payer_share,
            "category_id": None,
            "person_id": partner["id"],
            "account_id": account["id"],
            "from_account_id": None,
            "to_account_id": None,
            "payment_method": None,
            "description": description,
            "notes": "",
            "status": "paid",
            "currency": currency,
            "base_currency_at_creation": currency,
            "exchange_rate_to_base": 1.0,
            "base_amount": payer_share,
            "couple_link_id": link["id"],
            "created_at": now,
        }
        # Parte da outra pessoa: pendente a pagar, na data combinada.
        partner_expense = {
            "id": partner_id_tx,
            "user_id": partner["id"],
            "type": "expense",
            "date": due_on,
            "amount": partner_share,
            "category_id": None,
            "person_id": user["id"],
            "account_id": None,
            "from_account_id": None,
            "to_account_id": None,
            "payment_method": None,
            "description": description,
            "notes": "",
            "status": "pending",
            "currency": currency,
            "base_currency_at_creation": currency,
            "exchange_rate_to_base": 1.0,
            "base_amount": partner_share,
            "couple_link_id": link["id"],
            "counterparty_link_id": link_key,
            "counterparty_transaction_id": receivable_id,
            "counterparty_user_id": user["id"],
            "counterparty_role": "debtor",
            "counterparty_payment_state": "pending",
            "created_at": now,
        }
        # Espelho do lado de quem pagou: pendente a receber, na mesma data.
        receivable = {
            "id": receivable_id,
            "user_id": user["id"],
            "type": "income",
            "date": due_on,
            "amount": partner_share,
            "category_id": None,
            "person_id": partner["id"],
            "account_id": None,
            "from_account_id": None,
            "to_account_id": None,
            "payment_method": None,
            "description": description,
            "notes": "",
            "status": "pending",
            "currency": currency,
            "base_currency_at_creation": currency,
            "exchange_rate_to_base": 1.0,
            "base_amount": partner_share,
            "couple_link_id": link["id"],
            "counterparty_link_id": link_key,
            "counterparty_transaction_id": partner_id_tx,
            "counterparty_user_id": partner["id"],
            "counterparty_role": "creditor",
            "counterparty_payment_state": "pending",
            "created_at": now,
        }

        inserted = []
        try:
            for doc in (payer_expense, partner_expense, receivable):
                await db.transactions.insert_one(dict(doc))
                inserted.append(doc["id"])
        except Exception:
            for doc_id in inserted:
                await db.transactions.delete_one({"id": doc_id})
            raise

        try:
            await push_notification(
                partner["id"], "couple_shared_expense_added",
                "Conta dividida registrada",
                (
                    f"{user['name']} registrou uma conta dividida: sua parte é "
                    f"{fmt_money(partner_share, currency)}, a pagar até {due_on}: {description}."
                ),
                "/casal", {"transaction_id": partner_expense["id"]},
            )
        except Exception:
            pass

        return {
            "ok": True,
            "payer_expense_id": payer_expense["id"],
            "partner_expense_id": partner_expense["id"],
            "receivable_id": receivable["id"],
            "partner_share": partner_share,
            "payer_share": payer_share,
            "due_date": due_on,
        }

    @router.get("/shared-items")
    async def list_shared_items(user=Depends(get_current_user)):
        link = await _active_link_for(user["id"])
        if not link:
            return {"items": []}
        rows = await db.transactions.find(
            {"user_id": user["id"], "couple_link_id": link["id"]}, {"_id": 0},
        ).to_list(200)
        rows.sort(key=lambda row: row.get("date") or "", reverse=True)
        items = []
        for row in rows:
            if row.get("counterparty_role") not in ("creditor", "debtor"):
                continue
            items.append({
                "id": row["id"],
                "description": row.get("description", ""),
                "amount": row.get("amount", 0),
                "currency": row.get("currency", "EUR"),
                "date": row.get("date"),
                "status": row.get("status"),
                "role": row.get("counterparty_role"),
                "payment_state": row.get("counterparty_payment_state"),
            })
        return {"items": items}

    @router.post("/shared-items/{item_id}/received")
    async def mark_received(item_id: str, user=Depends(get_current_user)):
        """Quem vai receber dá baixa direto, nos dois lados."""
        row = await db.transactions.find_one(
            {"id": item_id, "user_id": user["id"], "counterparty_role": "creditor"},
            {"_id": 0},
        )
        if not row:
            raise HTTPException(404, "Lançamento não encontrado")
        if row.get("status") == "paid" or row.get("counterparty_payment_state") == "confirmed":
            raise HTTPException(409, "Este pagamento já foi confirmado")
        if row.get("counterparty_payment_state") not in SETTLEABLE_STATES:
            raise HTTPException(409, "Este lançamento não pode ser baixado agora")

        link_id = row.get("counterparty_link_id")
        now = now_iso()
        await db.transactions.update_many(
            {"counterparty_link_id": link_id},
            {"$set": {
                "status": "paid",
                "counterparty_payment_state": "confirmed",
                "counterparty_confirmed_at": now,
            }},
        )
        debtor_id = row.get("counterparty_user_id")
        try:
            await push_notification(
                debtor_id, "linked_payment_confirmed", "Pagamento confirmado",
                f"{user['name']} deu baixa no pagamento: {row.get('description', '')}.",
                "/casal", {"transaction_id": row.get("counterparty_transaction_id")},
            )
        except Exception:
            pass
        return {"ok": True, "status": "paid", "confirmed": True}

    return router


logger = logging.getLogger(__name__)
OVERDUE_CHECK_INTERVAL_SECONDS = 3600


async def notify_overdue_shared_items(
    db,
    push_notification: Callable[..., Awaitable[None]],
    fmt_money: Callable[[float, str], str],
) -> int:
    """Avisa quem deve, uma única vez, quando a data combinada passou sem pagamento.

    O pendente já aparece como atrasado no app, pela regra existente. Aqui só
    enviamos o aviso. A reivindicação é atômica, então duas instâncias não
    enviam o mesmo aviso duas vezes.
    """
    today = date.today().isoformat()
    rows = await db.transactions.find({
        "counterparty_role": "debtor",
        "counterparty_payment_state": "pending",
        "status": "pending",
        "couple_link_id": {"$exists": True},
        "date": {"$lt": today},
        "overdue_notified_at": {"$exists": False},
    }, {"_id": 0}).to_list(500)

    sent = 0
    for row in rows:
        claim = await db.transactions.update_one(
            {"id": row["id"], "overdue_notified_at": {"$exists": False}},
            {"$set": {"overdue_notified_at": datetime.now(timezone.utc).isoformat()}},
        )
        if getattr(claim, "modified_count", 0) != 1:
            continue
        try:
            await push_notification(
                row["user_id"], "couple_payment_overdue", "Pagamento em atraso",
                (
                    f"{fmt_money(row.get('amount', 0), row.get('currency', 'EUR'))} "
                    f"de \"{row.get('description', '')}\" venceu em {row.get('date')}. "
                    "Confirme o pagamento ou combine uma nova data."
                ),
                "/casal", {"transaction_id": row["id"]},
            )
            sent += 1
        except Exception:
            logger.warning("Overdue couple notification failed for %s", row["id"])
    return sent


async def run_overdue_loop(
    db,
    push_notification: Callable[..., Awaitable[None]],
    fmt_money: Callable[[float, str], str],
) -> None:
    while True:
        try:
            await notify_overdue_shared_items(db, push_notification, fmt_money)
        except Exception:
            logger.exception("Couple overdue check failed")
        await asyncio.sleep(OVERDUE_CHECK_INTERVAL_SECONDS)
