import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, HTTPException
from pydantic import ValidationError
from starlette.requests import Request

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault(
    "MONGO_URL",
    "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=10",
)
os.environ.setdefault("DB_NAME", "crelith_finance_test")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def request_from(ip="203.0.113.8"):
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/api/auth/password-reset/request",
        "headers": [],
        "client": (ip, 1234),
    })


def test_registration_schedules_confirmation_without_exposing_delivery_failure(monkeypatch):
    users = SimpleNamespace(
        find_one=AsyncMock(return_value=None),
        insert_one=AsyncMock(),
    )
    send_confirmation = AsyncMock(return_value=False)
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))
    monkeypatch.setattr(
        server,
        "email_service",
        SimpleNamespace(send_registration_received_email=send_confirmation),
    )
    tasks = BackgroundTasks()

    result = asyncio.run(server.register(
        server.RegisterIn(
            name="Nova Pessoa",
            email="nova@example.com",
            password="secret123",
            privacy_acknowledged=True,
        ),
        tasks,
    ))

    assert result["status"] == "pending"
    assert len(tasks.tasks) == 1
    assert tasks.tasks[0].func is send_confirmation


def test_password_reset_request_stores_only_hash_and_invalidates_previous(monkeypatch):
    user = {
        "id": "user-1",
        "email": "user@example.com",
        "language": "pt",
    }
    reset_requests = SimpleNamespace(
        count_documents=AsyncMock(return_value=0),
        insert_one=AsyncMock(),
    )
    reset_tokens = SimpleNamespace(
        update_many=AsyncMock(),
        insert_one=AsyncMock(),
    )
    users = SimpleNamespace(find_one=AsyncMock(return_value=user))
    raw_token = "raw-token-that-must-never-be-stored-" + ("x" * 32)
    monkeypatch.setattr(server.secrets, "token_urlsafe", lambda _size: raw_token)
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            users=users,
            password_reset_requests=reset_requests,
            password_reset_tokens=reset_tokens,
        ),
    )
    send_reset = AsyncMock()
    monkeypatch.setattr(
        server,
        "email_service",
        SimpleNamespace(
            public_settings=AsyncMock(return_value={"reset_expires_minutes": 30}),
            send_password_reset_email=send_reset,
        ),
    )
    tasks = BackgroundTasks()

    result = asyncio.run(server.request_password_reset(
        server.PasswordResetRequestIn(email=user["email"]),
        request_from(),
        tasks,
    ))

    assert result == {
        "ok": True,
        "message": server.PASSWORD_RESET_GENERIC_MESSAGE,
    }
    reset_tokens.update_many.assert_awaited_once()
    stored = reset_tokens.insert_one.await_args.args[0]
    assert stored["token_hash"] == server.hash_reset_token(raw_token)
    assert raw_token not in str(stored)
    assert len(tasks.tasks) == 1
    assert tasks.tasks[0].args[-1] == raw_token


def test_unknown_email_returns_same_response_without_creating_token(monkeypatch):
    reset_requests = SimpleNamespace(
        count_documents=AsyncMock(return_value=0),
        insert_one=AsyncMock(),
    )
    reset_tokens = SimpleNamespace(
        update_many=AsyncMock(),
        insert_one=AsyncMock(),
    )
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            users=SimpleNamespace(find_one=AsyncMock(return_value=None)),
            password_reset_requests=reset_requests,
            password_reset_tokens=reset_tokens,
        ),
    )
    tasks = BackgroundTasks()

    result = asyncio.run(server.request_password_reset(
        server.PasswordResetRequestIn(email="unknown@example.com"),
        request_from(),
        tasks,
    ))

    assert result["message"] == server.PASSWORD_RESET_GENERIC_MESSAGE
    reset_tokens.insert_one.assert_not_awaited()
    assert tasks.tasks == []


def test_password_reset_rate_limit_keeps_generic_response(monkeypatch):
    users = SimpleNamespace(find_one=AsyncMock())
    reset_requests = SimpleNamespace(
        count_documents=AsyncMock(return_value=server.PASSWORD_RESET_RATE_LIMIT),
    )
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            users=users,
            password_reset_requests=reset_requests,
        ),
    )

    result = asyncio.run(server.request_password_reset(
        server.PasswordResetRequestIn(email="user@example.com"),
        request_from(),
        BackgroundTasks(),
    ))

    assert result["message"] == server.PASSWORD_RESET_GENERIC_MESSAGE
    users.find_one.assert_not_awaited()


def test_password_reset_is_single_use_and_invalidates_sessions(monkeypatch):
    raw_token = "secure-reset-token-" + ("x" * 48)
    token_doc = {
        "id": "token-1",
        "user_id": "user-1",
        "token_hash": server.hash_reset_token(raw_token),
    }
    tokens = SimpleNamespace(
        find_one=AsyncMock(return_value=token_doc),
        update_one=AsyncMock(return_value=SimpleNamespace(modified_count=1)),
        update_many=AsyncMock(),
    )
    users = SimpleNamespace(
        find_one=AsyncMock(return_value={"id": "user-1"}),
        update_one=AsyncMock(),
    )
    ws_manager = SimpleNamespace(disconnect_user=AsyncMock())
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(password_reset_tokens=tokens, users=users),
    )
    monkeypatch.setattr(server, "ws_manager", ws_manager)

    result = asyncio.run(server.confirm_password_reset(server.PasswordResetIn(
        token=raw_token,
        new_password="new-secure-password",
    )))

    assert result == {"ok": True}
    claim = tokens.update_one.await_args.args[0]
    assert claim["token_hash"] == server.hash_reset_token(raw_token)
    assert raw_token not in str(claim)
    user_update = users.update_one.await_args.args[1]
    assert user_update["$inc"]["session_version"] == 1
    assert user_update["$set"]["password_hash"] != "new-secure-password"
    tokens.update_many.assert_awaited_once()
    ws_manager.disconnect_user.assert_awaited_once_with("user-1", code=4003)


def test_expired_or_used_reset_token_is_rejected(monkeypatch):
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(
            password_reset_tokens=SimpleNamespace(
                find_one=AsyncMock(return_value=None),
            ),
        ),
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.confirm_password_reset(server.PasswordResetIn(
            token="x" * 48,
            new_password="new-secure-password",
        )))

    assert exc.value.status_code == 400
    assert exc.value.detail == "Link inválido ou expirado"


def test_public_email_settings_never_returns_secret(monkeypatch):
    from email_service import EmailService

    monkeypatch.setenv("RESEND_API_KEY", "re_super_secret")
    database = SimpleNamespace(
        app_settings=SimpleNamespace(find_one=AsyncMock(return_value=None)),
    )

    result = asyncio.run(EmailService(database).public_settings())

    assert result["credential_configured"] is True
    assert "api_key" not in result
    assert "re_super_secret" not in str(result)


def test_admin_settings_reject_provider_credentials_in_payload():
    with pytest.raises(ValidationError):
        server.TransactionalEmailSettingsIn(
            enabled=True,
            registration_enabled=True,
            welcome_enabled=True,
            password_reset_enabled=True,
            from_name="Crelith Finance",
            from_email="mail@example.com",
            reset_url="https://www.crelithtech.com/redefinir-senha",
            reset_expires_minutes=30,
            api_key="must-not-be-accepted",
        )


def test_reset_token_is_put_in_url_fragment_not_query(monkeypatch):
    from email_service import EmailService

    service = EmailService(SimpleNamespace())
    monkeypatch.setattr(service, "_settings", AsyncMock(return_value={
        "password_reset_enabled": True,
        "reset_url": "https://www.crelithtech.com/redefinir-senha",
        "reset_expires_minutes": 30,
    }))
    send = AsyncMock(return_value=True)
    monkeypatch.setattr(service, "_send", send)
    token = "secret-token-" + ("x" * 48)

    asyncio.run(service.send_password_reset_email({
        "id": "user-1",
        "email": "user@example.com",
        "language": "pt",
    }, token))

    html = send.await_args.args[3]
    assert f"#token={token}" in html
    assert f"?token={token}" not in html


def test_delivery_and_audit_failures_do_not_raise(monkeypatch):
    from email_service import EmailService

    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    database = SimpleNamespace(
        app_settings=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        email_delivery_logs=SimpleNamespace(
            insert_one=AsyncMock(side_effect=RuntimeError("database unavailable")),
        ),
    )

    sent = asyncio.run(EmailService(database).send_welcome_email({
        "id": "user-1",
        "name": "User",
        "email": "user@example.com",
        "language": "pt",
    }))

    assert sent is False


def test_registration_and_approval_templates_are_distinct():
    from email_templates import registration_received_template, welcome_template

    logo_url = "https://www.crelithtech.com/logo-full-dark.png"
    registration_subject, registration_html = registration_received_template(
        "Pessoa", "pt", logo_url
    )
    welcome_subject, welcome_html = welcome_template("Pessoa", "pt", logo_url)

    assert "Cadastro recebido" in registration_subject
    assert "aguardando aprovação" in registration_html
    assert f'src="{logo_url}"' in registration_html
    assert 'alt="Crelith Finance"' in registration_html
    assert "Bem-vindo" in welcome_subject
    assert "acesso foi aprovado" in welcome_html
    assert f'src="{logo_url}"' in welcome_html
    assert "aguardando aprovação" not in welcome_html


@pytest.mark.parametrize("language", ["pt", "it", "en", "es"])
def test_both_account_lifecycle_emails_render_in_supported_languages(language):
    from email_templates import registration_received_template, welcome_template

    for template in (registration_received_template, welcome_template):
        subject, html = template("Pessoa", language)
        assert subject
        assert f'<html lang="{language}">' in html
        assert "Pessoa" in html


def test_public_templates_exposes_all_types_and_languages_without_secrets():
    from email_service import EmailService

    database = SimpleNamespace(
        email_templates=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        app_settings=SimpleNamespace(find_one=AsyncMock(return_value=None)),
    )

    templates = asyncio.run(EmailService(database).public_templates())

    assert len(templates) == 12
    assert {
        (item["template_type"], item["language"])
        for item in templates
    } == {
        (template_type, language)
        for template_type in ("registration_received", "welcome", "password_reset")
        for language in ("pt", "it", "en", "es")
    }
    assert "api_key" not in str(templates)


def test_customized_template_is_used_for_delivery(monkeypatch):
    from email_service import EmailService

    custom = {
        "id": "welcome:pt",
        "subject": "Conta liberada para {name}",
        "title": "Tudo pronto, {name}",
        "body": "Seu acesso está ativo.",
        "button_text": "Entrar agora",
        "button_url": "https://www.crelithtech.com/login",
        "footer": "Mensagem personalizada.",
    }
    database = SimpleNamespace(
        email_templates=SimpleNamespace(find_one=AsyncMock(return_value=custom)),
        app_settings=SimpleNamespace(find_one=AsyncMock(return_value=None)),
    )
    service = EmailService(database)
    send = AsyncMock(return_value=True)
    monkeypatch.setattr(service, "_send", send)

    asyncio.run(service.send_welcome_email({
        "id": "user-1",
        "name": "Marilia",
        "email": "user@example.com",
        "language": "pt",
    }))

    assert send.await_args.args[2] == "Conta liberada para Marilia"
    html = send.await_args.args[3]
    assert "Tudo pronto, Marilia" in html
    assert "Entrar agora" in html
    assert "Mensagem personalizada." in html


def test_template_render_escapes_markup_and_user_values():
    from email_templates import welcome_template

    subject, html = welcome_template(
        '<img src=x onerror="alert(1)">',
        "pt",
        fields={
            "subject": "Olá, {name}",
            "title": "<script>alert(1)</script>",
            "body": "Linha 1\nLinha 2 para {name}",
            "button_text": "<b>Entrar</b>",
            "button_url": "https://www.crelithtech.com/login",
            "footer": "",
        },
    )

    assert "<script>" not in html
    assert "<img src=x" not in html
    assert "&lt;script&gt;" in html
    assert "&lt;img src=x" in html
    assert "&lt;b&gt;Entrar&lt;/b&gt;" in html
    assert "<br>" in html
    assert "\r" not in subject
    assert "\n" not in subject


def test_template_rejects_unknown_placeholder():
    payload = server.EmailTemplateIn(
        subject="Olá {password}",
        title="Título",
        body="Conteúdo",
    )

    with pytest.raises(HTTPException) as exc:
        server.validate_email_template_payload("welcome", payload)

    assert exc.value.status_code == 400
    assert "{password}" in exc.value.detail


def test_template_rejects_non_https_button_url():
    payload = server.EmailTemplateIn(
        subject="Assunto",
        title="Título",
        body="Conteúdo",
        button_text="Abrir",
        button_url="javascript:alert(1)",
    )

    with pytest.raises(HTTPException) as exc:
        server.validate_email_template_payload("welcome", payload)

    assert exc.value.status_code == 400
    assert "HTTPS" in exc.value.detail


def test_password_reset_button_url_is_always_managed_by_system():
    payload = server.EmailTemplateIn(
        subject="Redefina sua senha",
        title="Redefinição",
        body="Use em {minutes} minutos.",
        button_text="Redefinir",
        button_url="https://attacker.example/collect",
    )

    fields = server.validate_email_template_payload("password_reset", payload)

    assert fields["button_url"] == ""
