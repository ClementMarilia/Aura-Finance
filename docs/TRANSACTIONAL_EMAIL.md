# E-mails transacionais

O MVP usa a API HTTPS do Resend para enviar:

- confirmação de cadastro enquanto a conta aguarda aprovação;
- boas-vindas quando a administradora aprova e ativa a conta;
- recuperação de senha por link temporário.

## Segredos

`RESEND_API_KEY` existe somente nas variáveis protegidas do backend no Render.
Ela não deve ser gravada no MongoDB, enviada ao frontend, adicionada ao Git ou
colada em tickets e logs.

O painel de administração permite editar somente configurações não secretas e
informa se a credencial está configurada. A API nunca retorna o valor da chave.
Também é possível definir a URL HTTPS da logo exibida no cabeçalho dos e-mails.

Os textos e a estrutura dos modelos ficam atualmente em
`backend/email_templates.py`. Não há editor de HTML no painel administrativo.

## Variáveis

Consulte `backend/.env.example`. Em produção:

1. valide o domínio no Resend;
2. publique os registros SPF e DKIM indicados pelo Resend no Cloudflare;
3. configure DMARC para o domínio;
4. defina `RESEND_API_KEY` e `EMAIL_FROM_ADDRESS` no ambiente protegido;
5. envie um teste em **Configurações → E-mails transacionais**.

## Segurança da recuperação

- a resposta da solicitação é igual para contas existentes e inexistentes;
- o token aleatório aparece apenas no link do e-mail;
- o token usa o fragmento do link e não é enviado ao servidor web em logs de navegação;
- o banco armazena somente o SHA-256 do token;
- o token expira, funciona uma vez e é invalidado por uma nova solicitação;
- a redefinição invalida todos os tokens pendentes e sessões anteriores;
- solicitações são limitadas por e-mail e origem;
- falhas guardam somente metadados técnicos e hash do destinatário.
