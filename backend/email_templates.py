from html import escape


COPY = {
    "pt": {
        "welcome_subject": "Bem-vindo à Crelith Finance",
        "welcome_title": "Cadastro recebido",
        "welcome_body": (
            "Olá, {name}. Recebemos seu cadastro na Crelith Finance. "
            "Sua conta está aguardando aprovação e você poderá entrar "
            "assim que o acesso for liberado."
        ),
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
        "welcome_subject": "Benvenuto in Crelith Finance",
        "welcome_title": "Registrazione ricevuta",
        "welcome_body": (
            "Ciao, {name}. Abbiamo ricevuto la tua registrazione a Crelith Finance. "
            "Il tuo account è in attesa di approvazione e potrai accedere "
            "non appena sarà autorizzato."
        ),
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
        "welcome_subject": "Welcome to Crelith Finance",
        "welcome_title": "Registration received",
        "welcome_body": (
            "Hello, {name}. We received your Crelith Finance registration. "
            "Your account is awaiting approval and you can sign in as soon as access is granted."
        ),
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
        "welcome_subject": "Bienvenido a Crelith Finance",
        "welcome_title": "Registro recibido",
        "welcome_body": (
            "Hola, {name}. Recibimos tu registro en Crelith Finance. "
            "Tu cuenta está pendiente de aprobación y podrás entrar cuando se autorice el acceso."
        ),
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


def _copy(language: str) -> dict:
    return COPY.get(language, COPY["pt"])


def _layout(
    title: str,
    body: str,
    action_html: str = "",
    footer: str = "",
    language: str = "pt",
) -> str:
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
                Crelith Finance
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


def welcome_template(name: str, language: str) -> tuple[str, str]:
    copy = _copy(language)
    safe_name = escape(name.strip() or "—")
    return (
        copy["welcome_subject"],
        _layout(
            copy["welcome_title"],
            copy["welcome_body"].format(name=safe_name),
            language=language,
        ),
    )


def password_reset_template(
    reset_url: str,
    language: str,
    expires_minutes: int,
) -> tuple[str, str]:
    copy = _copy(language)
    safe_url = escape(reset_url, quote=True)
    action = f"""
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 0">
        <tr>
          <td style="border-radius:12px;background:#1268f4">
            <a href="{safe_url}" style="display:inline-block;padding:14px 22px;
              color:#ffffff;text-decoration:none;font-weight:700">
              {copy["reset_button"]}
            </a>
          </td>
        </tr>
      </table>"""
    return (
        copy["reset_subject"],
        _layout(
            copy["reset_title"],
            copy["reset_body"].format(minutes=expires_minutes),
            action,
            f'{copy["ignore"]} {copy["security"]}',
            language,
        ),
    )
