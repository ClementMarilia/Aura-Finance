from html import escape
from string import Formatter
from typing import Optional


COPY = {
    "pt": {
        "registration_subject": "Cadastro recebido — Crelith Finance",
        "registration_title": "Cadastro recebido",
        "registration_body": (
            "Olá, {name}. Recebemos seu cadastro na Crelith Finance. "
            "Sua conta está aguardando aprovação. Enviaremos outro e-mail "
            "assim que seu acesso for liberado."
        ),
        "welcome_subject": "Bem-vindo à Crelith Finance",
        "welcome_title": "Seu acesso foi aprovado",
        "welcome_body": (
            "Olá, {name}. Seu cadastro foi aprovado e sua conta já está ativa. "
            "Você já pode entrar na Crelith Finance com o e-mail e a senha "
            "informados no cadastro."
        ),
        "welcome_button": "Acessar minha conta",
        "welcome_footer": "Seu acesso é pessoal. Não compartilhe sua senha.",
        "reset_subject": "Redefina sua senha da Crelith Finance",
        "reset_title": "Redefinição de senha",
        "reset_body": (
            "Recebemos uma solicitação para redefinir sua senha. "
            "Use o botão abaixo dentro de {minutes} minutos."
        ),
        "reset_button": "Redefinir minha senha",
        "ignore": "Se você não fez esta solicitação, ignore este e-mail.",
        "security": "Por segurança, este link pode ser usado apenas uma vez.",
    },
    "it": {
        "registration_subject": "Registrazione ricevuta — Crelith Finance",
        "registration_title": "Registrazione ricevuta",
        "registration_body": (
            "Ciao, {name}. Abbiamo ricevuto la tua registrazione a Crelith Finance. "
            "Il tuo account è in attesa di approvazione. Ti invieremo un'altra "
            "e-mail non appena il tuo accesso sarà autorizzato."
        ),
        "welcome_subject": "Benvenuto in Crelith Finance",
        "welcome_title": "Il tuo accesso è stato approvato",
        "welcome_body": (
            "Ciao, {name}. La tua registrazione è stata approvata e il tuo account "
            "è ora attivo. Puoi accedere a Crelith Finance con l'e-mail e la "
            "password indicate durante la registrazione."
        ),
        "welcome_button": "Accedi al mio account",
        "welcome_footer": "Il tuo accesso è personale. Non condividere la password.",
        "reset_subject": "Reimposta la password di Crelith Finance",
        "reset_title": "Reimpostazione della password",
        "reset_body": (
            "Abbiamo ricevuto una richiesta per reimpostare la tua password. "
            "Usa il pulsante qui sotto entro {minutes} minuti."
        ),
        "reset_button": "Reimposta la password",
        "ignore": "Se non hai effettuato questa richiesta, ignora questa e-mail.",
        "security": "Per sicurezza, questo link può essere utilizzato una sola volta.",
    },
    "en": {
        "registration_subject": "Registration received — Crelith Finance",
        "registration_title": "Registration received",
        "registration_body": (
            "Hello, {name}. We received your Crelith Finance registration. "
            "Your account is awaiting approval. We will send another email "
            "as soon as your access is granted."
        ),
        "welcome_subject": "Welcome to Crelith Finance",
        "welcome_title": "Your access has been approved",
        "welcome_body": (
            "Hello, {name}. Your registration has been approved and your account "
            "is now active. You can sign in to Crelith Finance with the email "
            "and password provided during registration."
        ),
        "welcome_button": "Access my account",
        "welcome_footer": "Your access is personal. Do not share your password.",
        "reset_subject": "Reset your Crelith Finance password",
        "reset_title": "Password reset",
        "reset_body": (
            "We received a request to reset your password. "
            "Use the button below within {minutes} minutes."
        ),
        "reset_button": "Reset my password",
        "ignore": "If you did not make this request, ignore this email.",
        "security": "For security, this link can be used only once.",
    },
    "es": {
        "registration_subject": "Registro recibido — Crelith Finance",
        "registration_title": "Registro recibido",
        "registration_body": (
            "Hola, {name}. Recibimos tu registro en Crelith Finance. "
            "Tu cuenta está pendiente de aprobación. Te enviaremos otro correo "
            "en cuanto se autorice tu acceso."
        ),
        "welcome_subject": "Bienvenido a Crelith Finance",
        "welcome_title": "Tu acceso ha sido aprobado",
        "welcome_body": (
            "Hola, {name}. Tu registro ha sido aprobado y tu cuenta ya está activa. "
            "Puedes entrar en Crelith Finance con el correo y la contraseña "
            "indicados durante el registro."
        ),
        "welcome_button": "Acceder a mi cuenta",
        "welcome_footer": "Tu acceso es personal. No compartas tu contraseña.",
        "reset_subject": "Restablece tu contraseña de Crelith Finance",
        "reset_title": "Restablecimiento de contraseña",
        "reset_body": (
            "Recibimos una solicitud para restablecer tu contraseña. "
            "Usa el botón de abajo dentro de {minutes} minutos."
        ),
        "reset_button": "Restablecer mi contraseña",
        "ignore": "Si no hiciste esta solicitud, ignora este correo.",
        "security": "Por seguridad, este enlace solo puede utilizarse una vez.",
    },
}

SUPPORTED_TEMPLATE_TYPES = ("registration_received", "welcome", "password_reset")
SUPPORTED_LANGUAGES = ("pt", "it", "en", "es")
ALLOWED_PLACEHOLDERS = {
    "registration_received": {"name"},
    "welcome": {"name"},
    "password_reset": {"minutes"},
}


def _copy(language: str) -> dict:
    return COPY.get(language, COPY["pt"])


def default_template_fields(template_type: str, language: str) -> dict:
    if template_type not in SUPPORTED_TEMPLATE_TYPES:
        raise ValueError("Unsupported email template type")
    copy = _copy(language)
    if template_type == "registration_received":
        return {
            "subject": copy["registration_subject"],
            "title": copy["registration_title"],
            "body": copy["registration_body"],
            "button_text": "",
            "button_url": "",
            "footer": "",
        }
    if template_type == "welcome":
        return {
            "subject": copy["welcome_subject"],
            "title": copy["welcome_title"],
            "body": copy["welcome_body"],
            "button_text": copy["welcome_button"],
            "button_url": "https://www.crelithtech.com/login",
            "footer": copy["welcome_footer"],
        }
    return {
        "subject": copy["reset_subject"],
        "title": copy["reset_title"],
        "body": copy["reset_body"],
        "button_text": copy["reset_button"],
        "button_url": "",
        "footer": f'{copy["ignore"]} {copy["security"]}',
    }


def template_placeholders(template_type: str) -> list[str]:
    return sorted(ALLOWED_PLACEHOLDERS.get(template_type, set()))


def validate_template_placeholders(template_type: str, fields: dict) -> None:
    allowed = ALLOWED_PLACEHOLDERS.get(template_type, set())
    for key in ("subject", "title", "body", "button_text", "footer"):
        for _, field_name, _, _ in Formatter().parse(fields.get(key, "")):
            if field_name and field_name not in allowed:
                raise ValueError(f"Placeholder not allowed: {{{field_name}}}")


def _render_text(value: str, variables: dict, multiline: bool = False) -> str:
    safe = escape(value.format(**variables), quote=False)
    return safe.replace("\n", "<br>") if multiline else safe


def _render_subject(value: str, variables: dict) -> str:
    return " ".join(value.format(**variables).replace("\r", " ").splitlines())


def _action(button_text: str, button_url: str, variables: Optional[dict] = None) -> str:
    if not button_text.strip() or not button_url.strip():
        return ""
    return f"""
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 0">
        <tr>
          <td style="border-radius:12px;background:#1268f4">
            <a href="{escape(button_url, quote=True)}" style="display:inline-block;padding:14px 22px;
              color:#ffffff;text-decoration:none;font-weight:700">
              {_render_text(button_text, variables or {})}
            </a>
          </td>
        </tr>
      </table>"""


def _layout(
    title: str,
    body: str,
    action_html: str = "",
    footer: str = "",
    language: str = "pt",
    logo_url: str = "",
) -> str:
    safe_logo_url = escape(logo_url, quote=True)
    brand = (
        f'<img src="{safe_logo_url}" width="190" alt="Crelith Finance" '
        'style="display:block;width:190px;max-width:100%;height:auto;border:0">'
        if safe_logo_url
        else "Crelith Finance"
    )
    return f"""<!doctype html>
<html lang="{escape(language)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body style="margin:0;background:#f4f6f8;
    font-family:Arial,sans-serif;color:#061b4a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
      style="background:#f4f6f8;padding:24px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
            style="max-width:600px;background:#ffffff;
              border-radius:18px;overflow:hidden">
            <tr>
              <td style="background:#04112f;padding:28px 32px;color:#ffffff;
                font-size:22px;font-weight:700">
                {brand}
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px">
                <h1 style="margin:0 0 18px;font-size:26px;line-height:1.25">{title}</h1>
                <p style="margin:0;color:#44506a;font-size:16px;line-height:1.65">{body}</p>
                {action_html}
                <p style="margin:28px 0 0;color:#7a8499;font-size:13px;
                  line-height:1.55">{footer}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def welcome_template(
    name: str,
    language: str,
    logo_url: str = "",
    fields: Optional[dict] = None,
) -> tuple[str, str]:
    content = {**default_template_fields("welcome", language), **(fields or {})}
    validate_template_placeholders("welcome", content)
    variables = {"name": name.strip() or "—"}
    return (
        _render_subject(content["subject"], variables),
        _layout(
            _render_text(content["title"], variables),
            _render_text(content["body"], variables, multiline=True),
            _action(content["button_text"], content["button_url"], variables),
            _render_text(content["footer"], variables, multiline=True),
            language=language,
            logo_url=logo_url,
        ),
    )


def registration_received_template(
    name: str,
    language: str,
    logo_url: str = "",
    fields: Optional[dict] = None,
) -> tuple[str, str]:
    content = {
        **default_template_fields("registration_received", language),
        **(fields or {}),
    }
    validate_template_placeholders("registration_received", content)
    variables = {"name": name.strip() or "—"}
    return (
        _render_subject(content["subject"], variables),
        _layout(
            _render_text(content["title"], variables),
            _render_text(content["body"], variables, multiline=True),
            _action(content["button_text"], content["button_url"], variables),
            _render_text(content["footer"], variables, multiline=True),
            language=language,
            logo_url=logo_url,
        ),
    )


def password_reset_template(
    reset_url: str,
    language: str,
    expires_minutes: int,
    logo_url: str = "",
    fields: Optional[dict] = None,
) -> tuple[str, str]:
    content = {**default_template_fields("password_reset", language), **(fields or {})}
    validate_template_placeholders("password_reset", content)
    variables = {"minutes": expires_minutes}
    return (
        _render_subject(content["subject"], variables),
        _layout(
            _render_text(content["title"], variables),
            _render_text(content["body"], variables, multiline=True),
            _action(content["button_text"], reset_url, variables),
            _render_text(content["footer"], variables, multiline=True),
            language,
            logo_url,
        ),
    )
