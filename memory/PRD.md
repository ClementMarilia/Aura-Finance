# PRD - Aurea: Controle Financeiro Pessoal e Compartilhado

## Original Problem Statement
Sistema web completo de controle financeiro pessoal e compartilhado em pt-BR. Cada usuário tem controle privado + participa de despesas compartilhadas com cálculo automático de acertos. Stack adaptada: React + FastAPI + MongoDB. Auth JWT customizado e-mail/senha. Moeda padrão EUR. Seed automático com 3 usuários (Wendy, Marilia, Nathalia / demo123) + despesa Mercado €222 dividida igualmente.

## User Personas
- **Usuário individual**: registra receitas/despesas, planeja com orçamento 50/20/10/10/10, acompanha parcelas.
- **Grupo (Casa/Viagem)**: divide gastos entre membros, vê automaticamente quem deve a quem.

## Architecture
- Backend: FastAPI + Motor (MongoDB) + bcrypt + PyJWT, prefixo `/api`
- Frontend: React 19 + React Router 7 + Tailwind + shadcn/ui + Recharts + sonner
- Auth: JWT em localStorage (Bearer header); axios interceptor injeta token
- Seed automático no startup (SEED_DEMO=true)

## Core Requirements (estáticas)
- Autenticação JWT, senhas com bcrypt
- Lançamentos (income/expense/transfer), parcelamentos, contas a receber
- Despesas compartilhadas com 3 tipos de divisão e privacidade por participante
- Acertos automáticos (quem deve a quem) + summary líquido
- Orçamento 50/20/10/10/10 calculado em tempo real sobre receita do mês
- Grupos privados (Casa, Viagem etc.)
- Categorias padrão + personalizadas
- Relatórios anuais

## What's Implemented (2026-02)- ✅ Auth completo: register, login, /me, profile update, change-password
- ✅ Categories CRUD + 11 categorias padrão seedadas por usuário
- ✅ Accounts (conta principal seedada automaticamente)
- ✅ Transactions CRUD com filtros (mês, ano, tipo, status, categoria)
- ✅ Installments: criação automática de N parcelas com toggle pago/pendente
- ✅ Receivables CRUD + toggle received/pending
- ✅ Shared expenses com splits equal/manual/percent + privacidade
- ✅ Groups CRUD + add member by email
- ✅ Settlements computados automaticamente (rows + summary líquido)
- ✅ Dashboard: 6 cards + evolução 6 meses (linha) + categoria (pizza) + orçamento
- ✅ Reports anual: cards totais + bar chart + tabela mensal
- ✅ Profile + Settings (gerenciar categorias)
- ✅ Layout responsivo: sidebar desktop + bottom nav mobile
- ✅ Seed 3 usuários demo + grupo Casa + despesa Mercado 222€

## Onda 5 — Lançamentos avançados (2026-06-24)
- ✅ Filtro temporal mês/ano em Lançamentos (params year+month em GET /transactions)
- ✅ Transferências entre contas: TransactionIn com from_account_id/to_account_id; GET /accounts retorna saldo computado por conta; validação origem≠destino e ownership
- ✅ Transações recorrentes: recurrences CRUD + toggle + materialize_recurrences (gera lançamentos retroativos e avança next_run) — página /recorrencias
- ✅ Anexar comprovantes: upload via Emergent Object Storage (EMERGENT_LLM_KEY), POST/DELETE /transactions/{id}/receipt, GET /files/{path} (Bearer ou ?auth=) — UI de anexar/ver/remover em Lançamentos
- Testado: iteration_3.json — 5/5 backend + frontend 100%

## Onda 4 — Relatórios avançados + Metas (2026-06-24)
- ✅ /reports/annual estendido com comparação ano a ano (YoY): totals, prev_year, prev_totals, prev_months
- ✅ /reports/projection: projeção de saldo dos próximos N meses (média dos últimos 6) — exibida no Painel (AreaChart)
- ✅ /insights: insights automáticos (taxa de poupança, tendência de gastos, maior categoria, contas pendentes) — seção no Painel
- ✅ Metas financeiras: goals CRUD + POST /goals/{id}/contribute (valida amount>0) — página /metas com barra de progresso e aporte
- ✅ Exportação CSV/PDF (client-side jsPDF) em Relatórios; CSV em Lançamentos
- Testado: iteration_2.json — 9/9 backend Onda 4 + fluxos frontend 100%

## Onda 2.5 + Onda 3 (2026-06-24)
- ✅ /acertos: botão "Cutucar" (nudge) nos cards + botão "Quitar tudo" + aba "Histórico" (GET /settlements/history)
- ✅ Página dedicada /notificacoes (filtro todas/não lidas, marcar lida, excluir, marcar todas)
- ✅ Preferências de notificação por tipo em /configuracoes (mute) — GET/PUT /notifications/preferences
- ✅ WebSocket /api/ws/notifications (auth via token query) — push em tempo real, substitui polling 30s (fallback 60s); ConnectionManager broadcast em push_notification, respeita mute
- ✅ DELETE /notifications/{nid}
- ⏭️ E-mail (Resend/SendGrid) ADIADO por escolha do usuário ("Decidir depois")

## Backlog (P1/P2)
- P1: Min length validation em senha (atualmente 4)
- P1: Brute-force lockout em /api/auth/login (5 tentativas / 15 min)
- P2: Reset de senha por e-mail
- P2: Upload de foto de perfil (object storage)
- P2: Notificações in-app de novas despesas compartilhadas
- P2: Exportar relatório CSV/PDF
- P2: Multi-moeda com conversão automática
- P2: Recorrências (aluguel todo mês)

## Test Credentials
- wendy@demo.com / demo123
- marilia@demo.com / demo123
- nathalia@demo.com / demo123
