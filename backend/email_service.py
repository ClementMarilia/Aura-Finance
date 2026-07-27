import asyncio
import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import requests

from email_templates import (
    SUPPORTED_LANGUAGES,
    SUPPORTED_TEMPLATE_TYPES,
    default_template_fields,
    password_reset_template,
    registration_received_template,
    template_placeholders,
    welcome_template,
)


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
            "registration_enabled": stored.get("registration_enabled", True),
            "welcome_enabled": stored.get("welcome_enabled", True),
            "password_reset_enabled": stored.get("password_reset_enabled", True),
            "from_name": stored.get("from_name") or os.environ.get(
                "EMAIL_FROM_NAME", "Crelith Finance"
            ),
            "from_email": stored.get("from_email") or os.environ.get(
                "EMAIL_FROM_ADDRESS", "onboarding@resend.dev"
            ),
            "reply_to": stored.get("reply_to") or os.environ.get("EMAIL_REPLY_TO", ""),
            "logo_url": stored.get("logo_url") or os.environ.get(
                "EMAIL_LOGO_URL",
                "https://www.crelithtech.com/logo-full-dark.png",
            ),
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

    async def template_fields(self, template_type: str, language: str) -> dict:
        defaults = default_template_fields(template_type, language)
        try:
            stored = await self.db.email_templates.find_one(
                {"id": f"{template_type}:{language}"},
                {"_id": 0},
            ) or {}
        except Exception:
            logger.exception(
                "Email template lookup failed: type=%s language=%s",
                template_type,
                language,
            )
            stored = {}
        fields = {
            key: stored.get(key, value)
            for key, value in defaults.items()
        }
        return {
            "template_type": template_type,
            "language": language,
            **fields,
            "is_customized": bool(stored),
            "placeholders": template_placeholders(template_type),
            "button_url_managed": template_type == "password_reset",
        }

    async def public_templates(self) -> list[dict]:
        return [
            await self.template_fields(template_type, language)
            for template_type in SUPPORTED_TEMPLATE_TYPES
            for language in SUPPORTED_LANGUAGES
        ]

    async def render_template(
        self,
        template_type: str,
        language: str,
        fields: Optional[dict] = None,
    ) -> tuple[str, str]:
        settings = await self._settings()
        selected = fields or await self.template_fields(template_type, language)
        if template_type == "registration_received":
            return registration_received_template(
                "Marilia",
                language,
                settings.get("logo_url", ""),
                selected,
            )
        if template_type == "welcome":
            return welcome_template(
                "Marilia",
                language,
                settings.get("logo_url", ""),
                selected,
            )
        return password_reset_template(
            f'{settings["reset_url"].split("#", 1)[0]}#token=preview',
            language,
            settings["reset_expires_minutes"],
            settings.get("logo_url", ""),
            selected,
        )

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

    async def send_registration_received_email(self, user: dict) -> bool:
        settings = await self._settings()
        if not settings["registration_enabled"]:
            return False
        language = user.get("language", "pt")
        fields = await self.template_fields("registration_received", language)
        subject, html = registration_received_template(
            user.get("name", ""),
            language,
            settings.get("logo_url", ""),
            fields,
        )
        return await self._send(
            "registration_received",
            user["email"],
            subject,
            html,
            user.get("id"),
        )

    async def send_welcome_email(self, user: dict) -> bool:
        settings = await self._settings()
        if not settings["welcome_enabled"]:
            return False
        language = user.get("language", "pt")
        fields = await self.template_fields("welcome", language)
        subject, html = welcome_template(
            user.get("name", ""),
            language,
            settings.get("logo_url", ""),
            fields,
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
        language = user.get("language", "pt")
        fields = await self.template_fields("password_reset", language)
        subject, html = password_reset_template(
            reset_url,
            language,
            settings["reset_expires_minutes"],
            settings.get("logo_url", ""),
            fields,
        )
        return await self._send(
            "password_reset",
            user["email"],
            subject,
            html,
            user.get("id"),
        )

    async def send_test_email(self, recipient: str, language: str = "pt") -> bool:
        settings = await self._settings()
        fields = await self.template_fields("welcome", language)
        subject, html = welcome_template(
            "Teste",
            language,
            settings.get("logo_url", ""),
            fields,
        )
        return await self._send("test", recipient, f"[TESTE] {subject}", html)
