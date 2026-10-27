# Enable Banking — POC e controle de acesso (BANK-001 a BANK-006)

Estado: prova de conceito somente leitura. Nenhuma conta bancária real foi conectada e nenhum lançamento ou saldo do Aura Finance será alterado pela prévia.

## Arquitetura

- Feature gate BANKING_ENABLED=false por padrão.
- Aplicação Enable Banking e chave RSA apenas no backend, nunca no React.
- Permissão interna no usuário autenticado (banking_access), armazenada pelo ID, não pelo e-mail.
- Somente SUPER_ADMIN pode conceder, recusar e revogar acesso.
- Decisões auditadas sem dados financeiros.
- A produção restrita da Enable Banking somente permite contas próprias vinculadas ao Control Panel: até mesmo um usuário aprovado internamente continua bloqueado no conector real nesse modo.
- Administração exibe identidade, permissão e estado do provedor; nunca extratos, saldos ou credenciais.

## Configuração

1. Registrar uma aplicação Sandbox na Enable Banking.
2. Para Production Restricted: criar outra aplicação e vincular uma conta própria do titular no Control Panel.
3. Autorizar no provedor a URL exata https://SEU-BACKEND/api/banking/callback.
4. Configurar as variáveis no backend: BANKING_ENABLED, ENABLE_BANKING_MODE (sandbox/restricted), ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY_FILE (ou ENABLE_BANKING_PRIVATE_KEY protegida no servidor), ENABLE_BANKING_CALLBACK_URL e BANKING_RETURN_URL.
5. Ativar BANKING_ENABLED=true somente após testes e verificação do contrato/condições.
6. Acessar Administração > Integrações bancárias para conferir o estado.
7. Em Conexões bancárias, selecionar instituição e autenticar-se no ambiente do banco.
8. Consultar prévia em leitura, sem inserir transações na carteira.

Atenção: liberar outra pessoa no Aura Finance NÃO permite consultar as contas dela por uma aplicação gratuita Restricted Production. Ver https://enablebanking.com/terms/ e https://enablebanking.com/docs/api/linked-accounts.

## Endpoints

- GET /api/banking/access — estado de permissão.
- POST /api/banking/request — solicitação de acesso.
- GET /api/admin/banking/config — configuração sem segredos (SUPER_ADMIN).
- GET /api/admin/banking/users — nomes e permissões (SUPER_ADMIN).
- PATCH /api/admin/banking/users/{id} — aprovar, recusar, revogar (SUPER_ADMIN).
- GET /api/banking/institutions — lista de instituições conforme país.
- POST /api/banking/connect — iniciar autorização.
- GET /api/banking/callback — estado único/expirável e troca do código por sessão.
- GET /api/banking/connections — listar conexões do próprio usuário.
- POST /api/banking/connections/{id}/sync — prévia limitada de saldos e quantidade de transações, intervalo mínimo de 6 h.
- DELETE /api/banking/connections/{id} — encerrar sessão no provedor e remover vínculo.

## Limitações intencionais da POC

- Sem importação automática no livro financeiro.
- Sem classificação ou deduplicação de movimentos reais nesta etapa.
- Sem sincronização agendada: apenas consulta manual respeitando limites.
- Sem suporte comercial a contas de terceiros na produção restrita.
- Ainda será necessário mapear carteiras, paginação completa, conciliação, reconexão e rotina de revogação remota após desativação administrativa.

## Testes

Testes unitários backend em backend/tests/test_banking_api.py. O PR deve executar CI para backend, frontend, traduções, build e orçamento de bundle antes do merge.
