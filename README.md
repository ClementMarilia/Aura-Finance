# Aura Finance — Controle Financeiro Pessoal e Compartilhado

Aura Finance é um **PWA (Progressive Web App)** em pt-BR de finanças pessoais e compartilhadas. Cada usuário gerencia receitas, despesas, parcelamentos, recorrências, metas e carteiras — e ao mesmo tempo participa de **grupos** (Casa, Viagem, etc.) com **divisão automática de despesas** e **acertos** (quem deve a quem). Pode ser **instalado na tela inicial** do celular e desktop como um app nativo.

> Stack: **React 19 + FastAPI + MongoDB**, autenticação JWT, moeda padrão **EUR (€)**. UI **com modo claro/escuro/automático**.

---

## Índice

- [Funcionalidades](#funcionalidades)
- [PWA & Dark Mode](#pwa--dark-mode)
- [Arquitetura](#arquitetura)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Como rodar](#como-rodar)
- [Credenciais demo (seed)](#credenciais-demo-seed)
- [Navegação](#navegação)
- [API (resumo)](#api-resumo)
- [Regras de negócio importantes](#regras-de-negócio-importantes)
- [Testes](#testes)
- [Deploy](#deploy)

---

## Funcionalidades

### Núcleo financeiro
- **Lançamentos** (income / expense / transfer) com filtros por mês, ano, tipo, status, categoria e carteira — todos **deep-linkáveis via query string** (ex: `/lancamentos?type=expense&status=pending&account_id=…`).
- **Confirmação de pagamento por lançamento**: botão ✓ em cada linha alterna `pending ↔ paid`. Pendentes **não afetam o saldo da carteira** até serem confirmadas e **rolam automaticamente** para o mês seguinte com selo "Atrasada" em vermelho.
- **Carteiras / Contas** (corrente, poupança, dinheiro, cartão, investimento) com saldo computado em tempo real **somando apenas `status=paid`** e **transferência entre carteiras**.
- **Parcelamentos**: criação automática de N parcelas; saldo só debita quando a parcela é confirmada; pendentes rolam para o mês seguinte.
- **Recorrências** (semanal / mensal / anual) com materialização **idempotente**; editar atualiza apenas pendentes; deletar remove só futuros.
- **Contas a Receber** com confirmação que gera receita e credita a carteira.
- **Comprovantes / anexos** em transações (upload via Emergent Object Storage).
- **Bulk delete** em Lançamentos com checkboxes.

### Categorias customizáveis
- Tipos: **`expense`**, **`income`** e **`both`**. Crie *Salário* (income), *Gasolina* (expense), etc.
- **Seed automático**: novos usuários ganham 11 categorias de despesa + 5 de receita (Salário, Freelance/Extra, Investimentos, Presente/Reembolso, Outras receitas).
- **Backfill no startup** garante que usuários antigos também recebam as categorias de receita padrão (idempotente — não duplica).
- Em `/configuracoes`, abas separadas para **Despesas / Receitas / Ambos** + criar / editar / excluir.

### Painel clicável
Cada card no Dashboard navega direto para a tela com filtro aplicado, mostrando exatamente o que compõe o número:

| Card | Destino |
|---|---|
| Saldo atual / Patrimônio | `/carteiras` |
| Receita do mês | `/lancamentos?type=income&year&month` |
| Despesa do mês | `/lancamentos?type=expense&year&month` |
| Contas pendentes | `/lancamentos?type=expense&status=pending&year&month` |
| A receber | `/contas-a-receber` |
| Parcelas futuras | `/parcelamentos` |
| Gasto fixo mensal | `/recorrencias` |
| **Cada carteira individual** | `/lancamentos?account_id=…` |

### Compartilhado & Acertos
- **Grupos** privados (Casa, Viagem etc.).
- **Despesas compartilhadas** com 3 modos: igual / manual / percentual; **ao escolher um grupo, todos os membros viram participantes automaticamente** — sem precisar digitar e-mail.
- Cada participante mostra **valor individual em destaque** (verde para o pagador; vermelho para quem deve; verde riscado para quem já pagou).
- **Botões contextuais**: "Confirmar recebimento" para o pagador / "Já paguei" para o devedor.
- **Banner compacto** no topo de `/despesas-compartilhadas` com o resumo total ("Marilia te deve € 74") e atalho para `/acertos`.
- Em `/acertos`: cards detalhados, **cutucar** (lembrete por notificação), **quitar tudo** de uma vez, **simplificação min-cash-flow** e **histórico**.

### Planejamento
- **Orçamento 50/20/10/10/10** calculado em tempo real.
- **Metas financeiras** com aporte/resgate (opcionalmente vinculados a uma carteira).

### Análise
- **Dashboard / Painel**: 6 cards clicáveis (Receita, Despesa, Saldo, Patrimônio, Recebíveis, Gasto fixo), evolução de 6 meses, gráfico de categorias, projeção e **insights automáticos**.
- **Relatórios anuais**: cards, **comparação YoY**, barras mensais, exportação CSV/PDF (jsPDF).

### Conta & segurança
- Auth JWT + bcrypt.
- **Recuperação de senha** por pergunta de segurança (fluxo público de 2 passos no Login + configuração em Perfil).
- **Notificações in-app** + push em **WebSocket** (`/api/ws/notifications`) com fallback de polling; preferências por tipo (mute).

---

## PWA & Dark Mode

### 📱 Instalável como app nativo
O Aura Finance é um **PWA completo**:

- **Manifest** (`/manifest.json`) com nome, ícones, atalhos e cores.
- **Service Worker** (`/service-worker.js`) com estratégia:
  - **HTML/JS/CSS**: stale-while-revalidate (rápido + atualiza em background)
  - **`/api/*`**: **nunca cacheado** (dados financeiros sempre frescos)
  - **Offline**: devolve a shell em cache se a rede cair
- **Ícones PNG reais** em 192px, 512px (`any` + `maskable`) + apple-touch-icon 180px + favicons.
- **Banner não-intrusivo** ("Instalar Aura Finance") no canto inferior:
  - 🤖 **Android/Chrome**: usa `beforeinstallprompt` (1-clique).
  - 🍎 **iOS Safari**: mostra instrução manual ("Compartilhar → Adicionar à Tela de Início").
  - Dispensável por 14 dias via `localStorage`.
- **Auto-update**: ao publicar nova versão, o SW força ativação e dá `controllerchange` reload.
- **Atalhos do app** (long-press no Android): Novo lançamento, Painel, Acertos.

> ⚠️ O SW só registra em `NODE_ENV=production` para não atrapalhar o hot-reload em dev.

### 🌗 Dark Mode (3 modos)
Toggle disponível no **header (topo direito)** e em `/configuracoes → Aparência`:

| Modo | Comportamento |
|---|---|
| ☀️ **Claro** | Verde escuro sobre creme (padrão) |
| 🌙 **Escuro** | Fundo `#0F1311`, cards `#1A1F1B`, verde claro `#6FB597` como destaque |
| 🖥️ **Sistema** | Segue `prefers-color-scheme` do SO em tempo real |

- Persistência em `localStorage('aurea_theme')`.
- **`<meta name="theme-color">` atualiza dinamicamente** — quando o app está instalado, a barra de status do iOS/Android acompanha o tema.
- Implementado via **variáveis CSS** + classe `.dark` no `<html>` + **overrides Tailwind** para classes hardcoded.
- Transição suave de 180ms entre temas.

### 🧑‍💼 Menu de conta sempre visível
O avatar + nome do usuário fica no **header (topo direito)** em todas as telas. Clicar abre dropdown com:
- 👤 **Perfil** (`/perfil`)
- ⚙️ **Configurações** (`/configuracoes`)
- ⏏️ **Sair** (em vermelho)

No mobile, o avatar aparece compacto (só a inicial), mas o dropdown é o mesmo.

---

## Arquitetura

```
┌─────────────────┐      HTTPS /api      ┌──────────────────┐      Motor      ┌──────────────┐
│  React 19 SPA   │ ───────────────────► │  FastAPI (8001)  │ ──────────────► │   MongoDB    │
│  PWA + SW       │     Bearer JWT       │  /api/* + WS     │                 │              │
│  Tailwind +     │ ◄─── WebSocket ────► │  bcrypt + PyJWT  │                 │              │
│  shadcn/ui      │                      └──────────────────┘                 └──────────────┘
│  Theme Provider │
└─────────────────┘
```

- **Backend**: FastAPI + Motor + bcrypt + PyJWT. Todas as rotas sob prefixo **`/api`** (ingress Kubernetes).
- **Frontend**: React 19 + React Router 7 + Tailwind + shadcn/ui (Radix) + Recharts + sonner. Axios com interceptor Bearer JWT.
- **PWA**: `manifest.json` + `service-worker.js` + `InstallPrompt` (auto-detecta Chrome/iOS).
- **Tema**: `ThemeContext` (Provider acima do `AuthProvider`) + variáveis CSS + classe `.dark`.
- **Persistência**: MongoDB com UUIDs (nunca ObjectId).
- **Tempo real**: `app.websocket("/api/ws/notifications")` autenticado via `?token=`.

---

## Estrutura do repositório

```
/app
├── backend/
│   ├── server.py            # FastAPI + Motor; todas as rotas /api/*
│   ├── requirements.txt
│   └── tests/
├── frontend/
│   ├── public/
│   │   ├── manifest.json            # PWA manifest
│   │   ├── service-worker.js        # Cache estratégico (API nunca cacheada)
│   │   ├── icon-192.png, icon-512.png, icon-maskable-*.png
│   │   ├── apple-touch-icon.png, favicon.ico
│   │   └── index.html               # meta PWA, theme-color dinâmico
│   ├── src/
│   │   ├── App.js
│   │   ├── index.js                 # ThemeProvider > QueryClient > App; registerSW()
│   │   ├── index.css                # vars CSS + .dark overrides
│   │   ├── sw-register.js           # registra SW só em produção
│   │   ├── context/
│   │   │   ├── AuthContext.js
│   │   │   └── ThemeContext.js      # light/dark/system + persistência
│   │   ├── components/
│   │   │   ├── Layout.jsx           # sidebar limpa + header c/ UserMenu
│   │   │   ├── UserMenu.jsx         # avatar dropdown (Perfil/Configurações/Sair)
│   │   │   ├── ThemeToggle.jsx      # 2 variantes: icon (cíclico) + segmented
│   │   │   ├── InstallPrompt.jsx    # banner "Instalar Aura Finance"
│   │   │   ├── NotificationsBell.jsx, ConfirmDialog.jsx
│   │   │   └── ui/                  # shadcn/ui
│   │   ├── lib/api.js               # axios + interceptor JWT
│   │   └── pages/                   # Dashboard, Transactions, ...
│   ├── package.json
│   ├── tailwind.config.js           # darkMode: ["class"]
│   └── craco.config.js
├── scripts/
├── tests/
├── memory/PRD.md                # histórico de entregas
├── test_result.md               # estado vivo de testes
└── README.md
```

---

## Variáveis de ambiente

> **Importante:** `frontend/.env` e `backend/.env` são gerenciados pela Vercel e pelo Render e **não devem ser versionados**. Use os arquivos `.env.example` apenas como referência.

### `backend/.env`
| Variável | Descrição |
|---|---|
| `MONGO_URL` | URL de conexão com o MongoDB. |
| `DB_NAME` | Nome do banco. |
| `JWT_SECRET` | Segredo para assinatura dos tokens JWT. |
| `SEED_DEMO` | `true` para seed automático no startup (3 usuários demo, grupo Casa, despesa Mercado €222). |
| `EMERGENT_LLM_KEY` | (opcional) usado para Emergent Object Storage de anexos. |

### `frontend/.env`
| Variável | Descrição |
|---|---|
| `REACT_APP_BACKEND_URL` | URL pública do backend (todas as chamadas usam o prefixo `/api`). |

---

## Como rodar

Os serviços são gerenciados via **supervisor** dentro do container:

```bash
sudo supervisorctl status                  # estado de frontend/backend/mongo
sudo supervisorctl restart backend         # após mudar .env ou requirements.txt
sudo supervisorctl restart frontend        # após instalar novas deps
sudo supervisorctl restart all
```

- **Backend** roda em `0.0.0.0:8001` (mapeado externamente pelo ingress; rotas com prefixo `/api`).
- **Frontend** roda em `:3000` com hot-reload (CRA + craco).
- **Dependências**:
  - Backend: `pip install -r backend/requirements.txt`
  - Frontend: `cd frontend && yarn install` (sempre **yarn**, nunca npm)

> Nunca inicie servers manualmente com `uvicorn` ou `npm start` — use `supervisorctl`.

---

## Credenciais demo (seed)

Com `SEED_DEMO=true`, o startup garante:

- `wendy@demo.com` / `demo123`
- `marilia@demo.com` / `demo123`
- `nathalia@demo.com` / `demo123`
- Grupo **Casa** com as três e despesa compartilhada **Mercado €222** dividida igualmente.
- Para cada usuário: 11 categorias de despesa + 5 de receita padrão + 1 conta principal.

---

## Navegação

### Sidebar (desktop) — 13 telas principais
Painel · Lançamentos · Recorrências · Parcelamentos · Contas a Receber · Orçamento · Carteiras · Metas · Despesas Compartilhadas · Grupos · Acertos · Relatórios · Notificações

### Header (topo direito, sempre visível)
🔔 Notificações &middot; 🌗 Tema &middot; 👤 **Avatar + Nome ▾** → dropdown (Perfil / Configurações / Sair)

### Mobile
- **Header**: logo + sino + tema + avatar compact
- **Bottom tab**: Painel · Lançamentos · Recorrências · Parcelamentos · Contas a Receber · **Mais** (→ `/configuracoes`)

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
POST   /auth/security-question                   # define (auth)
GET    /auth/security-question?email=...         # público (retorna pergunta ou null)
POST   /auth/reset-password-security             # público (email, answer, new_password)
GET    /users/search
```

### Categorias / Carteiras
```
GET|POST|PUT|DELETE /categories[/{cid}]          # CategoryIn aceita kind: expense|income|both
GET|POST|PUT|DELETE /accounts[/{aid}]            # saldo computado SÓ com transações status=paid
```

### Lançamentos / Comprovantes
```
GET    /transactions?year=&month=&type=&status=&category_id=&account_id=
       # quando year+month, inclui transações pendentes de meses anteriores com overdue=true (roll-over)
POST   /transactions                             # income | expense | transfer
PUT    /transactions/{tid}
DELETE /transactions/{tid}
POST   /transactions/bulk-delete                 # { ids: [...] } → { deleted: N }
POST   /transactions/{tid}/pay                   # toggle paid ↔ pending (afeta saldo)
POST   /transactions/{tid}/receipt               # upload de anexo
DELETE /transactions/{tid}/receipt
GET    /files/{path}                             # Bearer ou ?auth=
```

### Recorrências / Parcelamentos / Recebíveis
```
GET|POST|PUT|DELETE /recurrences[/{rid}]
POST   /recurrences/{rid}/toggle
GET|POST|PUT|DELETE /installments/purchases[/{pid}]
POST   /installments/{iid}/pay                   # toggle paid/pending → saldo da carteira
GET|POST|PUT|DELETE /receivables[/{rid}]
POST   /receivables/{rid}/receive                # toggle received/pending; cria/remove income vinculada
```

### Grupos / Despesas compartilhadas / Acertos
```
GET|POST|PUT|DELETE /groups[/{gid}]              # members vem populado (id, name, email, avatar_color)
POST   /groups/{gid}/members
DELETE /groups/{gid}/members/{uid}
GET|POST|PUT|DELETE /shared-expenses[/{sid}]     # split: equal | manual | percent
POST   /shared-expenses/{sid}/settle/{user_id}   # retorna {ok, status, paid_back}
GET    /settlements                              # rows + summary líquido + transfers (min-cash-flow)
GET    /settlements/history
POST   /settlements/settle-between/{other_id}    # quitar tudo
POST   /settlements/nudge/{debtor_id}            # cutucar
```

### Painel / Relatórios / Insights / Metas / Notificações
```
GET    /dashboard?year=&month=                   # cards, evolução, categorias, fixed_monthly_*
GET    /reports/annual?year=                     # totals + months + prev_year + prev_totals + prev_months
GET    /reports/projection?months=               # projeção (média 6m)
GET    /insights                                 # poupança, tendência, top categoria, contas pendentes
GET|POST|PUT|DELETE /goals[/{gid}]
POST   /goals/{gid}/contribute, /withdraw
GET    /notifications, /unread-count
POST   /notifications/{nid}/read, /read-all
DELETE /notifications/{nid}
GET|PUT /notifications/preferences
WS     /api/ws/notifications?token=...
```

---

## Regras de negócio importantes

- **Saldo da carteira** = soma de transações com `status=paid` apenas (parcelas, recorrências e recebíveis seguem mesma regra). **Pendentes nunca afetam o saldo** até serem confirmadas.
- **Roll-over automático**: GET `/transactions?year=Y&month=M` retorna lançamentos com data no mês **+** lançamentos pendentes de meses anteriores (flag `overdue=true`). O filtro `status=paid` exclui overdue; `status=pending` ou sem filtro incluem.
- **Confirmar pagamento** (`POST /transactions/{tid}/pay`) toggla `paid ↔ pending` (rejeita `cancelled` com 400).
- **Despesa do mês no Dashboard** = transações `expense` + recorrências materializadas + parcelas com vencimento no mês.
- **Materialize recorrência** é idempotente: nunca duplica `(recurrence_id, date)`.
- **Editar recorrência** atualiza lançamentos pendentes vinculados; pagos passados ficam intactos.
- **Deletar recorrência** remove apenas lançamentos futuros (`date > hoje`).
- **Lançamentos unificados**: GET `/transactions` mescla parcelas (`source='installment'`, badge "Parcela", `editable=false`) e recorrências (`source='recurrence'`, badge "Recorrente"). Vinculados são read-only.
- **Categorias por tipo**: ao criar lançamento, o dropdown filtra automaticamente — Receita só lista categorias `income` / `both`, Despesa só `expense` / `both`.
- **Auto-preenchimento por grupo**: ao escolher um grupo numa despesa compartilhada, todos os membros viram participantes (preservando quem já foi adicionado manualmente).
- **IDs**: UUIDs em tudo (nunca ObjectId).
- **Auth de WS**: token via query string (`?token=...`).

---

## Testes

- `pytest` no backend (`backend/tests/` e `tests/`).
- Relatórios em `/app/test_reports/iteration_*.json`.
- O arquivo `test_result.md` é o **estado vivo** do projeto: tarefas, status (`working` / `needs_retesting`), prioridade, comunicação main ↔ testing agent. **Não editar o bloco Testing Protocol.**
- Frontend validado por testing agent (auto_frontend_testing_agent) em todas as entregas — PWA, dark mode, deep-links do dashboard, confirmação de pagamento, banner de acertos, UserMenu.

---

## Deploy

### Arquitetura de produção

- **Frontend:** Vercel, com `frontend/` como Root Directory.
- **API FastAPI:** Render, serviço `name-aura-finance-backend`.
- **Banco de dados:** MongoDB, acessado exclusivamente pela API.
- **Domínios públicos:** `www.crelithtech.com` e `aura-finance-inky.vercel.app`.

### Fluxo de publicação

1. Desenvolva em uma branch e abra um Pull Request.
2. A Vercel gera o preview do frontend usando `frontend/vercel.json`.
3. Após validação, faça merge na `main` para publicar o frontend de produção.
4. O backend usa `render.yaml`, executa `uvicorn` e valida `/api/health` antes de receber tráfego.
5. Configure `REACT_APP_BACKEND_URL` na Vercel. Configure `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `CORS_ORIGINS`, `SEED_DEMO` e, quando necessário, `EMERGENT_LLM_KEY` no Render.

O endpoint `/api/health` confirma a conexão da API com o MongoDB sem expor credenciais ou detalhes do banco.

> O backfill das categorias de receita roda automaticamente no próximo boot do backend em produção (idempotente).

---

## Notas operacionais

- **Não modificar** `.env`, portas (`8001`/`3000`) nem `MONGO_URL` / `REACT_APP_BACKEND_URL`.
- Todas as rotas do backend **precisam** começar com `/api` (ingress redireciona).
- Para anexos, o backend usa **Emergent Object Storage** quando `EMERGENT_LLM_KEY` está presente; `GET /api/files/{path}` aceita Bearer ou `?auth=`.

---

© Aura Finance — controle financeiro pessoal e compartilhado · PWA instalável · light/dark/sistema.
