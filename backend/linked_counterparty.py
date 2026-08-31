"""Linked counterparty transaction workflow.

This module overrides only the direct-transaction mutation routes at application
startup. It keeps the historical ``server.py`` intact while adding a mirrored
receivable for registered counterparties and a two-sided payment confirmation
flow.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

import server as core


router = APIRouter(prefix="/api")


def _link_fields_unset() -> dict:
    return {
        "counterparty_link_id": "",
        "counterparty_transaction_id": "",
        "counterparty_user_id": "",
        "counterparty_role": "",
        "counterparty_payment_state": "",
    }


async def _registered_counterparty(person_id: Optional[str], user: dict) -> Optional[dict]:
    """Resolve a transaction person to an active Crelith account, when possible."""
    if not person_id:
        return None

    person = await core.db.people.find_one(
        {"id": person_id, "owner_user_id": user["id"]},
        {"_id": 0},
    )
    if person:
        email = str(person.get("email") or "").strip().lower()
        if not email:
            return None
        return await core.db.users.find_one(
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

    # A registered user may also be referenced directly when an existing shared
    # relationship already made that user selectable in the transaction UI.
    return await core.db.users.find_one(
        {
            "id": person_id,
            "$or": [
                {"status": "active"},
                {"status": {"$exists": False}},
            ],
        },
        {"_id": 0, "password_hash": 0},
    )


def _is_linkable_expense(transaction: dict) -> bool:
    return (
        transaction.get("type") == "expense"
        and transaction.get("status") == "pending"
        and bool(transaction.get("person_id"))
    )


def _mirror_values(source: dict, debtor: dict, creditor: dict) -> dict:
    """Build the creditor-side pending income without leaking debtor categories/accounts."""
    currency = core.normalize_currency(
        source.get("currency"),
        debtor.get("currency", "EUR"),
    )
    creditor_base = core.normalize_currency(creditor.get("currency", "EUR"))
    rates = dict(source.get("exchange_rates") or {})
    if currency == creditor_base:
        rate_to_base = 1.0
        rates.setdefault(currency, 1.0)
    else:
        rate_to_base = float(rates.get(creditor_base) or 1.0)

    return {
        "type": "income",
        "date": source.get("date"),
        "amount": source.get("amount"),
        "category_id": None,
        "person_id": debtor["id"],
        "account_id": None,
        "from_account_id": None,
        "to_account_id": None,
        "payment_method": None,
        "description": source.get("description", ""),
        "notes": source.get("notes", ""),
        "status": "pending",
        "currency": currency,
        "exchange_rates": rates,
        "base_currency_at_creation": creditor_base,
        "exchange_rate_to_base": rate_to_base,
        "base_amount": round(float(source.get("amount") or 0) * rate_to_base, 2),
        "rate_date": source.get("rate_date"),
        "rate_source": source.get("rate_source"),
    }


async def _notify_link_created(source: dict, debtor: dict, creditor: dict) -> None:
    currency = core.normalize_currency(
        source.get("currency"),
        debtor.get("currency", "EUR"),
    )
    description = (source.get("description") or "").strip()
    suffix = f": {description}" if description else "."
    await core.push_notification(
        creditor["id"],
        "linked_receivable_created",
        "Novo valor a receber",
        (
            f"{debtor['name']} registrou {core.fmt_eur(source.get('amount', 0), currency)} "
            f"que deve a você{suffix}"
        ),
        "/lancamentos",
        {
            "transaction_id": source.get("counterparty_transaction_id"),
            "source_transaction_id": source["id"],
            "debtor_user_id": debtor["id"],
            "amount": source.get("amount", 0),
            "currency": currency,
        },
    )


async def _create_link(source: dict, debtor: dict, creditor: dict) -> dict:
    link_id = core.new_id()
    mirror_id = core.new_id()
    source_update = {
        "counterparty_link_id": link_id,
        "counterparty_transaction_id": mirror_id,
        "counterparty_user_id": creditor["id"],
        "counterparty_role": "debtor",
        "counterparty_payment_state": "pending",
    }
    mirror = {
        "id": mirror_id,
        "user_id": creditor["id"],
        **_mirror_values(source, debtor, creditor),
        "counterparty_link_id": link_id,
        "counterparty_transaction_id": source["id"],
        "counterparty_user_id": debtor["id"],
        "counterparty_role": "creditor",
        "counterparty_payment_state": "pending",
        "created_at": core.now_iso(),
    }

    try:
        await core.db.transactions.insert_one(mirror)
        await core.db.transactions.update_one(
            {"id": source["id"], "user_id": debtor["id"]},
            {"$set": source_update},
        )
    except Exception:
        await core.db.transactions.delete_one(
            {"id": mirror_id, "user_id": creditor["id"]}
        )
        raise

    source.update(source_update)
    mirror.pop("_id", None)
    try:
        await _notify_link_created(source, debtor, creditor)
    except Exception as exc:
        core.logger.warning(
            "Linked-counterparty notification failed for %s: %s",
            source["id"],
            exc,
        )
    return mirror


async def _sync_existing_link(source: dict, debtor: dict, creditor: dict) -> None:
    mirror_id = source.get("counterparty_transaction_id")
    if not mirror_id:
        return
    mirror_update = {
        **_mirror_values(source, debtor, creditor),
        "counterparty_payment_state": source.get(
            "counterparty_payment_state", "pending"
        ),
    }
    await core.db.transactions.update_one(
        {"id": mirror_id, "user_id": creditor["id"]},
        {"$set": mirror_update},
    )


async def _remove_unconfirmed_link(source: dict) -> None:
    if not source.get("counterparty_link_id"):
        return
    if source.get("counterparty_payment_state") == "confirmed":
        raise HTTPException(
            409,
            "Um lançamento confirmado pela outra pessoa não pode ser desvinculado",
        )
    mirror_id = source.get("counterparty_transaction_id")
    creditor_id = source.get("counterparty_user_id")
    if mirror_id and creditor_id:
        await core.db.transactions.delete_one(
            {"id": mirror_id, "user_id": creditor_id}
        )
    await core.db.transactions.update_one(
        {"id": source["id"], "user_id": source["user_id"]},
        {"$unset": _link_fields_unset()},
    )


@router.post("/transactions")
async def create_transaction(
    payload: core.TransactionIn,
    user=Depends(core.get_current_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    async def create():
        await core._validate_transfer(payload, user)
        await core.validate_transaction_person(payload.person_id, user)
        values = await core.transaction_values(payload, user)
        doc = {
            "id": core.new_id(),
            "user_id": user["id"],
            **values,
            "created_at": core.now_iso(),
        }
        await core.db.transactions.insert_one(doc)
        doc.pop("_id", None)

        if _is_linkable_expense(doc):
            creditor = await _registered_counterparty(doc.get("person_id"), user)
            if creditor:
                try:
                    await _create_link(doc, user, creditor)
                except Exception:
                    await core.db.transactions.delete_one(
                        {"id": doc["id"], "user_id": user["id"]}
                    )
                    raise
        else:
            try:
                await core.notify_pending_receivable_counterparty(doc, user)
            except Exception as exc:
                core.logger.warning(
                    "Pending-receivable notification failed for transaction %s: %s",
                    doc["id"],
                    exc,
                )
        return doc

    return await core.run_idempotent_create(
        "create_transaction",
        user["id"],
        idempotency_key,
        payload.model_dump(),
        create,
    )


@router.put("/transactions/{tid}")
async def update_transaction(
    tid: str,
    payload: core.TransactionIn,
    user=Depends(core.get_current_user),
):
    await core._validate_transfer(payload, user)
    await core.validate_transaction_person(payload.person_id, user)
    current = await core.db.transactions.find_one(
        {"id": tid, "user_id": user["id"]},
        {"_id": 0},
    )
    if not current:
        raise HTTPException(404, "Não encontrado")
    if current.get("shared_expense_id") or current.get("settlement_payment_id"):
        raise HTTPException(
            409,
            "Edite este lançamento pela operação financeira vinculada",
        )
    if current.get("counterparty_role") == "creditor":
        raise HTTPException(
            409,
            "Este lançamento foi criado pela outra pessoa e não pode ser editado diretamente",
        )
    if current.get("counterparty_payment_state") == "confirmed":
        raise HTTPException(
            409,
            "Um lançamento já confirmado pela outra pessoa não pode ser alterado",
        )

    values = await core.transaction_values(payload, user)
    updated = {**current, **values}
    await core.db.transactions.update_one(
        {"id": tid, "user_id": user["id"]},
        {"$set": values},
    )

    existing_link = bool(current.get("counterparty_link_id"))
    if _is_linkable_expense(updated):
        creditor = await _registered_counterparty(updated.get("person_id"), user)
        if creditor:
            same_creditor = (
                existing_link
                and current.get("counterparty_user_id") == creditor["id"]
            )
            if same_creditor:
                updated.update({
                    "counterparty_link_id": current.get("counterparty_link_id"),
                    "counterparty_transaction_id": current.get(
                        "counterparty_transaction_id"
                    ),
                    "counterparty_user_id": creditor["id"],
                    "counterparty_role": "debtor",
                    "counterparty_payment_state": current.get(
                        "counterparty_payment_state", "pending"
                    ),
                })
                await _sync_existing_link(updated, user, creditor)
            else:
                if existing_link:
                    await _remove_unconfirmed_link(current)
                await _create_link(updated, user, creditor)
        elif existing_link:
            await _remove_unconfirmed_link(current)
    elif existing_link:
        await _remove_unconfirmed_link(current)
    else:
        try:
            await core.notify_pending_receivable_counterparty(updated, user)
        except Exception as exc:
            core.logger.warning(
                "Pending-receivable notification failed for transaction %s: %s",
                tid,
                exc,
            )
    return {"ok": True}


@router.delete("/transactions/{tid}")
async def delete_transaction(
    tid: str,
    user=Depends(core.get_current_user),
):
    tx = await core.db.transactions.find_one(
        {"id": tid, "user_id": user["id"]},
        {"_id": 0},
    )
    if not tx:
        return {"ok": True}
    if tx.get("shared_expense_id") or tx.get("settlement_payment_id"):
        raise HTTPException(
            409,
            "Exclua este lançamento pela operação financeira vinculada",
        )
    if tx.get("counterparty_role") == "creditor":
        raise HTTPException(
            409,
            "Este lançamento é o espelho de uma operação criada por outra pessoa",
        )
    if tx.get("counterparty_payment_state") == "confirmed":
        raise HTTPException(
            409,
            "Um lançamento confirmado pela outra pessoa não pode ser excluído",
        )

    if tx.get("counterparty_link_id"):
        await _remove_unconfirmed_link(tx)
    if tx.get("receipt"):
        await core.db.files.update_one(
            {"id": tx["receipt"]["file_id"]},
            {"$set": {"is_deleted": True}},
        )
    await core.db.transactions.delete_one(
        {"id": tid, "user_id": user["id"]}
    )
    return {"ok": True}


@router.post("/transactions/{tid}/pay")
async def toggle_transaction_payment(
    tid: str,
    user=Depends(core.get_current_user),
):
    tx = await core.db.transactions.find_one(
        {"id": tid, "user_id": user["id"]},
        {"_id": 0},
    )
    if not tx:
        raise HTTPException(404, "Lançamento não encontrado")
    if tx.get("shared_expense_id") or tx.get("settlement_payment_id"):
        raise HTTPException(
            409,
            "O pagamento é controlado pela operação financeira vinculada",
        )
    if tx.get("status") == "cancelled":
        raise HTTPException(400, "Lançamento cancelado não pode ser pago")

    role = tx.get("counterparty_role")
    state = tx.get("counterparty_payment_state")

    if role == "debtor":
        if state == "confirmed":
            raise HTTPException(
                409,
                "O recebimento já foi confirmado pela outra pessoa",
            )
        if state == "awaiting_confirmation":
            raise HTTPException(
                409,
                "A confirmação de recebimento já foi solicitada",
            )
        creditor_id = tx.get("counterparty_user_id")
        mirror_id = tx.get("counterparty_transaction_id")
        if not creditor_id or not mirror_id:
            raise HTTPException(409, "Vínculo financeiro incompleto")
        await core.db.transactions.update_many(
            {"counterparty_link_id": tx["counterparty_link_id"]},
            {"$set": {"counterparty_payment_state": "awaiting_confirmation"}},
        )
        currency = core.normalize_currency(
            tx.get("currency"), user.get("currency", "EUR")
        )
        try:
            await core.push_notification(
                creditor_id,
                "linked_payment_confirmation_requested",
                "Confirme o recebimento",
                (
                    f"{user['name']} informou o pagamento de "
                    f"{core.fmt_eur(tx.get('amount', 0), currency)}."
                ),
                "/lancamentos",
                {
                    "transaction_id": mirror_id,
                    "source_transaction_id": tid,
                    "amount": tx.get("amount", 0),
                    "currency": currency,
                },
            )
        except Exception as exc:
            core.logger.warning(
                "Payment-confirmation notification failed for %s: %s",
                tid,
                exc,
            )
        return {
            "ok": True,
            "status": "pending",
            "confirmation_pending": True,
        }

    if role == "creditor":
        if state != "awaiting_confirmation":
            raise HTTPException(
                409,
                "Ainda não existe um pagamento aguardando sua confirmação",
            )
        link_id = tx.get("counterparty_link_id")
        debtor_id = tx.get("counterparty_user_id")
        await core.db.transactions.update_many(
            {"counterparty_link_id": link_id},
            {
                "$set": {
                    "status": "paid",
                    "counterparty_payment_state": "confirmed",
                    "counterparty_confirmed_at": core.now_iso(),
                }
            },
        )
        try:
            await core.push_notification(
                debtor_id,
                "linked_payment_confirmed",
                "Pagamento confirmado",
                f"{user['name']} confirmou o recebimento do pagamento.",
                "/lancamentos",
                {
                    "transaction_id": tx.get("counterparty_transaction_id"),
                    "counterparty_transaction_id": tid,
                },
            )
        except Exception as exc:
            core.logger.warning(
                "Payment-confirmed notification failed for %s: %s",
                tid,
                exc,
            )
        return {"ok": True, "status": "paid", "confirmed": True}

    new_status = "pending" if tx.get("status") == "paid" else "paid"
    await core.db.transactions.update_one(
        {"id": tid, "user_id": user["id"]},
        {"$set": {"status": new_status}},
    )
    return {"ok": True, "status": new_status}


@router.post("/transactions/{tid}/reject-payment")
async def reject_linked_payment(
    tid: str,
    user=Depends(core.get_current_user),
):
    tx = await core.db.transactions.find_one(
        {"id": tid, "user_id": user["id"]},
        {"_id": 0},
    )
    if not tx:
        raise HTTPException(404, "Lançamento não encontrado")
    if tx.get("counterparty_role") != "creditor":
        raise HTTPException(
            403,
            "Somente quem deve receber pode rejeitar a confirmação",
        )
    if tx.get("counterparty_payment_state") != "awaiting_confirmation":
        raise HTTPException(
            409,
            "Não existe pagamento aguardando confirmação",
        )

    link_id = tx.get("counterparty_link_id")
    debtor_id = tx.get("counterparty_user_id")
    await core.db.transactions.update_many(
        {"counterparty_link_id": link_id},
        {
            "$set": {
                "status": "pending",
                "counterparty_payment_state": "rejected",
                "counterparty_rejected_at": core.now_iso(),
            }
        },
    )
    try:
        await core.push_notification(
            debtor_id,
            "linked_payment_rejected",
            "Pagamento não confirmado",
            f"{user['name']} informou que o pagamento ainda não foi recebido.",
            "/lancamentos",
            {
                "transaction_id": tx.get("counterparty_transaction_id"),
                "counterparty_transaction_id": tid,
            },
        )
    except Exception as exc:
        core.logger.warning(
            "Payment-rejected notification failed for %s: %s",
            tid,
            exc,
        )
    return {"ok": True, "status": "pending", "rejected": True}


@router.post("/transactions/bulk-delete")
async def bulk_delete_transactions(
    body: core.BulkDeleteIn,
    user=Depends(core.get_current_user),
):
    if not body.ids:
        return {"deleted": 0}
    txs = await core.db.transactions.find(
        {"id": {"$in": body.ids}, "user_id": user["id"]},
        {"_id": 0},
    ).to_list(5000)

    deletable_ids = []
    mirror_deletes = []
    for tx in txs:
        protected = (
            tx.get("shared_expense_id")
            or tx.get("settlement_payment_id")
            or tx.get("counterparty_role") == "creditor"
            or tx.get("counterparty_payment_state") == "confirmed"
        )
        if protected:
            continue
        deletable_ids.append(tx["id"])
        if tx.get("counterparty_link_id"):
            mirror_deletes.append(
                (
                    tx.get("counterparty_transaction_id"),
                    tx.get("counterparty_user_id"),
                )
            )
        if tx.get("receipt"):
            await core.db.files.update_one(
                {"id": tx["receipt"]["file_id"]},
                {"$set": {"is_deleted": True}},
            )

    for mirror_id, creditor_id in mirror_deletes:
        if mirror_id and creditor_id:
            await core.db.transactions.delete_one(
                {"id": mirror_id, "user_id": creditor_id}
            )

    res = await core.db.transactions.delete_many(
        {"id": {"$in": deletable_ids}, "user_id": user["id"]}
    )
    return {"deleted": res.deleted_count}


_REPLACED_ROUTES = {
    ("/api/transactions", frozenset({"POST"})),
    ("/api/transactions/{tid}", frozenset({"PUT"})),
    ("/api/transactions/{tid}", frozenset({"DELETE"})),
    ("/api/transactions/{tid}/pay", frozenset({"POST"})),
    ("/api/transactions/bulk-delete", frozenset({"POST"})),
}


def install_linked_counterparty_routes(app) -> None:
    """Replace the historical mutation endpoints with the linked workflow."""
    kept = []
    for route in app.router.routes:
        methods = frozenset(getattr(route, "methods", set()) or set())
        key = (getattr(route, "path", ""), methods)
        if key in _REPLACED_ROUTES:
            continue
        kept.append(route)
    app.router.routes[:] = kept
    app.include_router(router)
