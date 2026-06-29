# Aurea — Controle Financeiro Pessoal e Compartilhado

Aurea é um sistema web completo (pt-BR) de **finanças pessoais e compartilhadas**. Cada usuário gerencia suas próprias receitas, despesas, parcelamentos, recorrências, metas e carteiras — e ao mesmo tempo participa de **grupos** (Casa, Viagem, etc.) com **divisão automática de despesas** e **acertos** (quem deve a quem).

> Stack: **React 19 + FastAPI + MongoDB**, autenticação JWT, moeda padrão **EUR (€)**.

---

## Índice

- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Como rodar](#como-rodar)
- [Credenciais demo (seed)](#credenciais-demo-seed)
- [Rotas do frontend](#rotas-do-frontend)
- [API (resumo)](#api-resumo)
- [Regras de negócio importantes](#regras-de-negócio-importantes)
- [Testes](#testes)
- [Notas operacionais](#notas-operacionais)

---

## Funcionalidades

### Núcleo financeiro
- **Lançamentos** (income / expense / transfer) com filtros por mês, ano, tipo, status, categoria e carteira.
- **Carteiras / Contas** (corrente, poupança, dinheiro, cartão, investimento) com saldo computado em tempo real e **transferência entre carteiras**.
- **Parcelamentos**: criação automática de N parcelas; saldo da carteira só é debitado quando a parcela é **confirmada (paga)**; pendentes rolam para o mês seguinte; resumo de Total pendente / pago.
- **Recorrências** (semanal / mensal / anual) com materialização **idempotente** dos lançamentos; ao deletar a recorrência, os lançamentos **futuros** são removidos e os passados preservados.
- **Contas a Receber** com confirmação de recebimento que gera lançamento de receita e **credita a carteira escolhida** (desfazer reverte; deletar remove a transação vinculada).
- **Comprovantes / anexos** em transações (upload via Emergent Object Storage).
- **Bulk delete** em Lançamentos com checkboxes e barra de ações.

### Compartilhado
- **Grupos** privados (Casa, Viagem etc.) com membros por e-mail.
- **Despesas compartilhadas** com 3 modos de divisão: igual, manual e por percentual; privacidade por participante.
- **Acertos automáticos** (settlements): linhas "X deve Y €Z" + summary líquido + **Quitar tudo**, **Cutucar (nudge)** e **Histórico**.

### Planejamento
- **Orçamento 50/20/10/10/10** calculado em tempo real sobre a receita do mês, com seletor de mês/ano.
- **Metas financeiras** com aporte (`/contribute`) e resgate (`/withdraw`), opcionalmente vinculadas a uma conta (transferência real).
- **Categorias** padrão (11 seedadas) + personalizadas.

### Visão e análise
- **Dashboard / Painel**: 6 cards (Receita, Despesa, Saldo, Patrimônio, Recebíveis do mês, Gasto fixo mensal), evolução de 6 meses, gráfico de categorias, projeção de saldo (AreaChart) e **insights automáticos**.
- **Relatórios anuais**: cards de totais, comparação **ano a ano (YoY)**, barras mensais, exportação CSV/PDF (client-side, jsPDF).
- **Exportação CSV** em Lançamentos.

### Conta e segurança
- Auth JWT com bcrypt; `/auth/me`, atualização de perfil, troca de senha.
- **Recuperação de senha por pergunta de segurança** (fluxo público de 2 passos no Login + configuração no Perfil). Resposta normalizada (trim + lowercase, case-insensitive) e armazenada como hash bcrypt.
- **Notificações in-app** com preferências por tipo (mute) e push em **WebSocket** (`/api/ws/notifications`) — fallback de polling.

---

## Arquitetura

```
┌─────────────────┐      HTTPS /api      ┌──────────────────┐      Motor      ┌──────────────┐
│  React 19 SPA   │ ───────────────────► │  FastAPI (8001)  │ ──────────────► │   MongoDB    │
│  Tailwind +     │     Bearer JWT       │  /api/* + WS     │                 │              │
│  shadcn/ui      │ ◄─── WebSocket ────► │  bcrypt + PyJWT  │                 │              │
└─────────────────┘                      └──────────────────┘                 └──────────────┘
```

- **Backend**: FastAPI + Motor (MongoDB async) + bcrypt + PyJWT. Todas as rotas sob prefixo **`/api`** (exigido pelo ingress do Kubernetes).
- **Frontend**: React 19 + React Router 7 + Tailwind + shadcn/ui (Radix) + Recharts + sonner. Axios com interceptor injetando o Bearer token de `localStorage`.
- **Persistência**: MongoDB com IDs **UUID** (não usa ObjectId para serialização limpa).
- **Tempo real**: `app.websocket("/api/ws/notifications")` autenticado via `?token=`.
- **Arquivos**: anexos servidos via `GET /api/files/{path}` (Bearer ou `?auth=`).

---

## Estrutura do repositório

```
/app
├── backend/
│   ├── server.py            # FastAPI + Motor; todas as rotas /api/*
│   ├── requirements.txt
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── App.js           # rotas e providers
│   │   ├── context/AuthContext.js
│   │   ├── lib/api.js       # axios + interceptor JWT
│   │   ├── components/      # Layout, NotificationsBell, ConfirmDialog, ui/*
│   │   └── pages/           # Dashboard, Transactions, Installments, Wallets, ...
│   ├── package.json
│   ├── tailwind.config.js
│   └── craco.config.js
├── scripts/
│   └── dedupe_recurrences.py
├── tests/                   # pytest
├── memory/PRD.md            # Product Requirements (histórico de entregas)
├── test_result.md           # estado vivo de testes (protocolo do projeto)
└── README.md
```

---

## Variáveis de ambiente

> **Importante:** `frontend/.env` e `backend/.env` são gerenciados pelo ambiente e **não devem ser modificados**.

### `backend/.env`
| Variável | Descrição |
|---|---|
| `MONGO_URL` | URL de conexão com o MongoDB local. |
| `DB_NAME` | Nome do banco. |
| `JWT_SECRET` | Segredo para assinatura dos tokens JWT. |
| `SEED_DEMO` | `true` para seed automático no startup (usuários demo, grupo Casa e despesa Mercado €222). |
| `EMERGENT_LLM_KEY` | (opcional) usado para Emergent Object Storage de anexos. |

### `frontend/.env`
| Variável | Descrição |
|---|---|
| `REACT_APP_BACKEND_URL` | URL pública do backend (todas as chamadas precisam ser sob `/api`). |

---

## Como rodar

Os serviços já são gerenciados via **supervisor** dentro do container.

```bash
sudo supervisorctl status                  # ver estado de frontend/backend/mongo
sudo supervisorctl restart backend         # após mudar .env do backend ou requirements.txt
sudo supervisorctl restart frontend        # após instalar novas deps do frontend
sudo supervisorctl restart all
```

- **Backend** roda em `0.0.0.0:8001` (mapeado externamente pelo ingress; todas rotas com prefixo `/api`).
- **Frontend** roda em `:3000` com hot-reload (CRA + craco).
- **Dependências**:
  - Backend: `pip install -r backend/requirements.txt`
  - Frontend: `cd frontend && yarn install` (sempre **yarn**, nunca npm)

> Não inicie servidores manualmente com `uvicorn` ou `npm start` — use sempre o `supervisorctl`.

---

## Credenciais demo (seed)

Com `SEED_DEMO=true`, o startup garante:

- `wendy@demo.com` / `demo123`
- `marilia@demo.com` / `demo123`
- `nathalia@demo.com` / `demo123`
- Grupo **Casa** com as três e despesa compartilhada **Mercado €222** dividida igualmente.
- Para cada usuário: 11 categorias padrão + 1 conta principal.

---

## Rotas do frontend

| Path | Página |
|---|---|
| `/login`, `/cadastro` | Autenticação |
| `/` | Dashboard / Painel |
| `/lancamentos` | Transactions (filtros, bulk delete, anexos) |
| `/parcelamentos` | Installments (cards recolhíveis, pagar parcela) |
| `/contas-a-receber` | Receivables |
| `/recorrencias` | Recurrences |
| `/carteiras` | Wallets (CRUD + transferência) |
| `/orcamento` | Budget 50/20/10/10/10 |
| `/metas` | Goals (aporte / resgate) |
| `/despesas-compartilhadas` | Shared expenses |
| `/grupos` | Groups |
| `/acertos` | Settlements (quitar tudo, cutucar, histórico) |
| `/relatorios` | Annual reports + exportação |
| `/notificacoes` | Notifications |
| `/perfil`, `/configuracoes` | Profile + Settings |

---

## API (resumo)

Prefixo: **`/api`**. Auth: header `Authorization: Bearer <token>`.

### Autenticação
```
POST   /auth/register
POST   /auth/login
GET    /auth/me
PUT    /auth/profile
POST   /auth/change-password
POST   /auth/security-question                  # define (auth)
GET    /auth/security-question?email=...        # público (retorna pergunta ou null)
POST   /auth/reset-password-security            # público (email, answer, new_password)
GET    /users/search
```

### Categorias / Carteiras
```
GET|POST|PUT|DELETE /categories[/{cid}]
GET|POST|PUT|DELETE /accounts[/{aid}]            # saldo computado deduz parcelas pagas
```

### Lançamentos / Comprovantes
```
GET    /transactions?year=&month=&type=&status=&category_id=&account_id=
POST   /transactions                             # income | expense | transfer (from_account_id/to_account_id)
PUT    /transactions/{tid}
DELETE /transactions/{tid}
POST   /transactions/bulk-delete                 # { ids: [...] } → { deleted: N }
POST   /transactions/{tid}/receipt               # upload de anexo
DELETE /transactions/{tid}/receipt
GET    /files/{path}                             # Bearer ou ?auth=
```

### Recorrências
```
GET    /recurrences
POST   /recurrences                              # frequency, next_run, account_id, ...
PUT    /recurrences/{rid}                        # propaga para lançamentos PENDENTES
POST   /recurrences/{rid}/toggle
DELETE /recurrences/{rid}                        # remove lançamentos FUTUROS (date > hoje)
```

### Parcelamentos
```
GET    /installments/purchases
POST   /installments/purchases                   # gera N parcelas (account_id opcional)
PUT    /installments/purchases/{pid}             # aceita account_id (editar carteira)
DELETE /installments/purchases/{pid}
POST   /installments/{iid}/pay                   # toggle paid/pending → saldo da carteira
```

### Contas a receber
```
GET    /receivables
POST   /receivables                              # account_id obrigatório para creditar carteira
PUT    /receivables/{rid}
POST   /receivables/{rid}/receive                # toggle received/pending; cria/remove income vinculada
DELETE /receivables/{rid}                        # remove transação vinculada
```

### Grupos / Despesas compartilhadas / Acertos
```
GET|POST|PUT|DELETE /groups[/{gid}]
POST   /groups/{gid}/members
DELETE /groups/{gid}/members/{uid}
GET|POST|PUT|DELETE /shared-expenses[/{sid}]     # split: equal | manual | percent
POST   /shared-expenses/{sid}/settle/{user_id}
GET    /settlements                              # rows + summary líquido
GET    /settlements/history
POST   /settlements/settle-between/{other_id}    # quitar tudo
POST   /settlements/nudge/{debtor_id}            # cutucar
```

### Painel / Relatórios / Insights / Metas
```
GET    /dashboard?year=&month=                   # cards, evolução, categorias, fixed_monthly_*, installments_month_total
GET    /reports/annual?year=                     # totals + months + prev_year + prev_totals + prev_months (YoY)
GET    /reports/projection?months=               # projeção (média 6m)
GET    /insights                                 # poupança, tendência, top categoria, contas pendentes
GET|POST|PUT|DELETE /goals[/{gid}]
POST   /goals/{gid}/contribute                   # opcional from_account_id (transferência real)
POST   /goals/{gid}/withdraw                     # opcional to_account_id
```

### Notificações
```
GET    /notifications
GET    /notifications/unread-count
POST   /notifications/{nid}/read
POST   /notifications/read-all
DELETE /notifications/{nid}
GET|PUT /notifications/preferences               # mute por tipo
WS     /api/ws/notifications?token=...           # push em tempo real
```

---

## Regras de negócio importantes

- **Saldo da carteira** = receitas paid − despesas paid − **parcelas paid** vinculadas à conta − transferências saindo + transferências entrando. Parcelas **pendentes não afetam** o saldo até serem confirmadas.
- **Despesa do mês no Dashboard** = transações `expense` + recorrências materializadas + parcelas com vencimento no mês. Esse mesmo critério é usado no **Relatório Anual** (consistência).
- **Materialize recorrência** é **idempotente**: nunca insere se já existe `(recurrence_id, date)`. O horizonte é o último dia do mês atual (ocorrências `<= hoje` são `paid`, futuras do mês são `pending`).
- **Editar recorrência** (`PUT`) atualiza os lançamentos PENDENTES vinculados — pagos passados ficam como histórico.
- **Deletar recorrência** remove apenas lançamentos **futuros** (`date > hoje`).
- **Lançamentos** mescla parcelas (`source='installment'`, badge "Parcela", `editable=false`) e recorrências (`source='recurrence'`, badge "Recorrente"). Itens vinculados são read-only.
- **Confirmar recebível**: cria transação `income` com `notes='(conta a receber)'`, `status=paid` e `receivable_id`; desfazer remove. Excluir o recebível também remove a transação vinculada.
- **IDs**: todo documento usa **UUID** (nunca `ObjectId`) para serialização limpa.
- **Auth de WS**: token vai por query string (`?token=...`).

---

## Testes

- `pytest` no backend (`backend/tests/` e `tests/`).
- Relatórios automáticos em `/app/test_reports/iteration_*.json`.
- O arquivo `test_result.md` é o **estado vivo** do projeto: histórico de tarefas, estado de cada feature (`working`/`needs_retesting`), prioridade e comunicação main↔testing agent. **Não editar o bloco de Testing Protocol.**

---

## Notas operacionais

- **Não modificar** `.env`, portas (`8001`/`3000`) nem `MONGO_URL`/`REACT_APP_BACKEND_URL`.
- Todas as rotas do backend **precisam** começar com `/api` (ingress redireciona).
- Para anexos, o backend usa **Emergent Object Storage** quando `EMERGENT_LLM_KEY` está presente; o GET `/api/files/{path}` aceita Bearer ou `?auth=`.
- Para reset de dados de seed, basta apagar a collection users (cuidado em produção) — o startup recria os 3 usuários demo + grupo + despesa compartilhada.

---

© Aurea — projeto MVP de finanças pessoais e compartilhadas.
