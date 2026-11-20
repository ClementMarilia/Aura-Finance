"""Vínculo de casal por convite: envio, aceite, recusa, cancelamento e encerramento.

Ao aceitar, cria-se um grupo do tipo ``couple`` com os dois membros. Assim, as
despesas compartilhadas e os acertos já existentes passam a funcionar para o
casal sem um sistema de dívidas paralelo.

Regras:
- Cada pessoa tem no máximo um vínculo aberto (pendente ou ativo).
- O convite só pode ser enviado para contas ativas.
- A resposta ao convite nunca revela se um e-mail está cadastrado.
- Encerrar o vínculo não apaga o grupo nem o histórico de acertos.
"""

from __future__ import annotations

from typing import Awaitable, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

COUPLE_GROUP_KIND = "couple"
COUPLE_GROUP_NAME = "Nós dois"
OPEN_STATUSES = ("pending", "active")
INVITE_RESPONSE = {
    "status": "sent_if_registered",
    "message": "Se este e-mail tiver uma conta ativa, o convite foi enviado.",
}


class CoupleInvitationIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)


def create_couple_router(
    *,
    db,
    get_current_user,
    push_notification: Callable[..., Awaitable[None]],
    send_invite_email: Callable[[dict, str], Awaitable[bool]],
    new_id: Callable[[], str],
    now_iso: Callable[[], str],
) -> APIRouter:
    router = APIRouter(prefix="/api/couple", tags=["couple"])

    async def _active_user_by_email(email: str) -> Optional[dict]:
        return await db.users.find_one(
            {
                "email": email,
                "$or": [{"status": "active"}, {"status": {"$exists": False}}],
            },
            {"_id": 0, "password_hash": 0},
        )

    async def _open_link_for(user_id: str) -> Optional[dict]:
        return await db.couple_links.find_one(
            {
                "status": {"$in": list(OPEN_STATUSES)},
                "$or": [{"requester_id": user_id}, {"partner_id": user_id}],
            },
            {"_id": 0},
        )

    def _partner_id(link: dict, user_id: str) -> str:
        return link["partner_id"] if link["requester_id"] == user_id else link["requester_id"]

    async def _public_partner(user_id: str) -> Optional[dict]:
        if not user_id:
            return None
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "name": 1})
        return {"id": user_id, "name": (user or {}).get("name", "")} if user else None

    async def _find_link(link_id: str) -> dict:
        link = await db.couple_links.find_one({"id": link_id}, {"_id": 0})
        if not link:
            raise HTTPException(404, "Convite não encontrado")
        return link

    @router.get("")
    async def get_couple(user=Depends(get_current_user)):
        link = await _open_link_for(user["id"])
        if not link:
            return {"link": None, "direction": None, "partner": None}
        direction = "outgoing" if link["requester_id"] == user["id"] else "incoming"
        if link["status"] == "pending" and direction == "incoming":
            partner = await _public_partner(link["requester_id"])
        else:
            partner = await _public_partner(_partner_id(link, user["id"]))
        return {"link": link, "direction": direction, "partner": partner}

    @router.post("/invitations", status_code=202)
    async def invite(payload: CoupleInvitationIn, user=Depends(get_current_user)):
        email = payload.email.strip().lower()
        if "@" not in email:
            raise HTTPException(400, "E-mail inválido")
        if await _open_link_for(user["id"]):
            raise HTTPException(409, "Você já tem um vínculo ou convite em aberto")
        partner = await _active_user_by_email(email)
        if not partner or partner["id"] == user["id"]:
            return INVITE_RESPONSE
        if await _open_link_for(partner["id"]):
            return INVITE_RESPONSE

        now = now_iso()
        link = {
            "id": new_id(),
            "requester_id": user["id"],
            "partner_id": partner["id"],
            "status": "pending",
            "group_id": "",
            "created_at": now,
            "updated_at": now,
            "responded_at": "",
        }
        await db.couple_links.insert_one(dict(link))
        try:
            await push_notification(
                partner["id"], "couple_invite", "Convite para conectar contas",
                f"{user['name']} convidou você para compartilharem finanças como casal.",
                "/casal", {"link_id": link["id"]},
            )
        except Exception:
            pass
        try:
            await send_invite_email(partner, user["name"])
        except Exception:
            pass
        return INVITE_RESPONSE

    @router.post("/{link_id}/accept")
    async def accept(link_id: str, user=Depends(get_current_user)):
        link = await _find_link(link_id)
        if link["partner_id"] != user["id"] or link["status"] != "pending":
            raise HTTPException(404, "Convite não encontrado")
        if await db.couple_links.find_one(
            {"status": "active", "$or": [
                {"requester_id": user["id"]}, {"partner_id": user["id"]},
                {"requester_id": link["requester_id"]}, {"partner_id": link["requester_id"]},
            ]},
        ):
            raise HTTPException(409, "Um dos dois já está em um vínculo de casal")

        now = now_iso()
        group = {
            "id": new_id(),
            "name": COUPLE_GROUP_NAME,
            "description": "",
            "kind": COUPLE_GROUP_KIND,
            "creator_id": link["requester_id"],
            "member_ids": [link["requester_id"], link["partner_id"]],
            "admin_ids": [link["requester_id"], link["partner_id"]],
            "created_at": now,
        }
        await db.groups.insert_one(dict(group))
        await db.couple_links.update_one(
            {"id": link_id},
            {"$set": {"status": "active", "group_id": group["id"],
                      "updated_at": now, "responded_at": now}},
        )
        try:
            await push_notification(
                link["requester_id"], "couple_accepted", "Convite aceito",
                f"{user['name']} aceitou conectar as contas de vocês como casal.",
                "/casal", {"link_id": link_id},
            )
        except Exception:
            pass
        return {**link, "status": "active", "group_id": group["id"],
                "updated_at": now, "responded_at": now}

    async def _close(link_id: str, user_id: str, *, as_partner: bool, new_status: str):
        link = await _find_link(link_id)
        expected_side = "partner_id" if as_partner else "requester_id"
        if link[expected_side] != user_id or link["status"] != "pending":
            raise HTTPException(404, "Convite não encontrado")
        now = now_iso()
        await db.couple_links.update_one(
            {"id": link_id},
            {"$set": {"status": new_status, "updated_at": now, "responded_at": now}},
        )
        return {**link, "status": new_status, "updated_at": now, "responded_at": now}

    @router.post("/{link_id}/decline")
    async def decline(link_id: str, user=Depends(get_current_user)):
        link = await _close(link_id, user["id"], as_partner=True, new_status="declined")
        try:
            await push_notification(
                link["requester_id"], "couple_declined", "Convite recusado",
                f"{user['name']} recusou o convite de casal.", "/casal",
                {"link_id": link_id},
            )
        except Exception:
            pass
        return link

    @router.post("/{link_id}/cancel")
    async def cancel(link_id: str, user=Depends(get_current_user)):
        return await _close(link_id, user["id"], as_partner=False, new_status="cancelled")

    @router.post("/end")
    async def end_link(user=Depends(get_current_user)):
        link = await db.couple_links.find_one(
            {"status": "active", "$or": [{"requester_id": user["id"]}, {"partner_id": user["id"]}]},
            {"_id": 0},
        )
        if not link:
            raise HTTPException(404, "Nenhum vínculo de casal ativo")
        now = now_iso()
        await db.couple_links.update_one(
            {"id": link["id"]},
            {"$set": {"status": "ended", "updated_at": now}},
        )
        return {**link, "status": "ended", "updated_at": now}

    return router
