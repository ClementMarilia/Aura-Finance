import asyncio
import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import requests

from email_templates import password_reset_template, welcome_template


logger = logging.getLogger("finance.email")
RESEND_API_URL = "https://api.resend.com/emails"


class EmailService:
    """Resend transport that never exposes or persists provider credentials."""

    def __init__(self, database):
        self.db = database

    @staticmethod
    def is_configured() -> bool:
        return bool(os.environ.get("RESEND_API_KEY", "").strip())

    async def _settings(self) -> dict:
        try:
            stored = await self.db.app_settings.find_one(
                {"id": "transactional_email"},
                {"_id": 0},
            ) or {}
        except Exception:
            logger.exception("Transactional email settings lookup failed")
            stored = {}
        return {
            "enabled": stored.get("enabled", True),
            "welcome_enabled": stored.get("welcome_enabled", True),
            "password_reset_enabled": stored.get("password_reset_enabled", True),
            "from_name": stored.get("from_name") or os.environ.get(
                "EMAIL_FROM_NAME", "Crelith Finance"
            ),
            "from_email": stored.get("from_email") or os.environ.get(
                "EMAIL_FROM_ADDRESS", "onboarding@resend.dev"
            ),
            "reply_to": stored.get("reply_to") or os.environ.get("EMAIL_REPLY_TO", ""),
            "reset_url": stored.get("reset_url") or os.environ.get(
                "PASSWORD_RESET_URL",
                "https://www.crelithtech.com/redefinir-senha",
            ),
            "reset_expires_minutes": int(
                stored.get("reset_expires_minutes")
                or os.environ.get("PASSWORD_RESET_EXPIRES_MINUTES", "30")
            ),
        }

    async def public_settings(self) -> dict:
        settings = await self._settings()
        return {
            **settings,
            "provider": "Resend",
            "credential_configured": self.is_configured(),
        }

    async def _record_failure(
        self,
        email_type: str,
        recipient: str,
        user_id: Optional[str],
        status_code: Optional[int],
        reason: str,
    ) -> None:
        recipient_hash = hashlib.sha256(recipient.lower().encode()).hexdigest()
        try:
            await self.db.email_delivery_logs.insert_one({
                "id": os.urandom(16).hex(),
                "email_type": email_type,
                "user_id": user_id,
                "recipient_hash": recipient_hash,
                "status": "failed",
                "provider": "resend",
                "provider_status_code": status_code,
                "reason": reason,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            logger.exception(
                "Transactional email failure log could not be persisted: type=%s user=%s",
                email_type,
                user_id or "unknown",
            )

    async def _send(
        self,
        email_type: str,
        recipient: str,
        subject: str,
        html: str,
        user_id: Optional[str] = None,
    ) -> bool:
        settings = await self._settings()
        api_key = os.environ.get("RESEND_API_KEY", "").strip()
        if not settings["enabled"] or not api_key:
            await self._record_failure(
                email_type, recipient, user_id, None, "provider_not_configured"
            )
            logger.warning(
                "Transactional email skipped: type=%s user=%s provider_configured=%s",
                email_type,
                user_id or "unknown",
                bool(api_key),
            )
            return False

        payload = {
            "from": f'{settings["from_name"]} <{settings["from_email"]}>',
            "to": [recipient],
            "subject": subject,
            "html": html,
        }
        if settings["reply_to"]:
            payload["reply_to"] = settings["reply_to"]

        def request():
            return requests.post(
                RESEND_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=12,
            )

        try:
            response = await asyncio.to_thread(request)
            if response.status_code >= 400:
                await self._record_failure(
                    email_type,
                    recipient,
                    user_id,
                    response.status_code,
                    "provider_rejected",
                )
                logger.warning(
                    "Transactional email rejected: type=%s user=%s status=%s",
                    email_type,
                    user_id or "unknown",
                    response.status_code,
                )
                return False
            return True
        except Exception:
            await self._record_failure(
                email_type, recipient, user_id, None, "transport_error"
            )
            logger.exception(
                "Transactional email transport failed: type=%s user=%s",
                email_type,
                user_id or "unknown",
            )
            return False

    async def send_welcome_email(self, user: dict) -> bool:
        settings = await self._settings()
        if not settings["welcome_enabled"]:
            return False
        subject, html = welcome_template(
            user.get("name", ""),
            user.get("language", "pt"),
        )
        return await self._send(
            "welcome",
            user["email"],
            subject,
            html,
            user.get("id"),
        )

    async def send_password_reset_email(self, user: dict, token: str) -> bool:
        settings = await self._settings()
        if not settings["password_reset_enabled"]:
            return False
        reset_url = f'{settings["reset_url"].split("#", 1)[0]}#token={token}'
        subject, html = password_reset_template(
            reset_url,
            user.get("language", "pt"),
            settings["reset_expires_minutes"],
        )
        return await self._send(
            "password_reset",
            user["email"],
            subject,
            html,
            user.get("id"),
        )

    async def send_test_email(self, recipient: str, language: str = "pt") -> bool:
        subject, html = welcome_template("Teste", language)
        return await self._send("test", recipient, f"[TESTE] {subject}", html)
