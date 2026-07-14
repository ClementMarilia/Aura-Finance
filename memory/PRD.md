# PRD - Aura Finance: Controle Financeiro Pessoal e Compartilhado

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

## Recuperação de senha por pergunta de segurança (2025-07)
- ✅ Sem integração externa (escolha do usuário): pergunta + resposta (resposta com hash bcrypt)
- ✅ Backend: POST /auth/security-question (auth, define); GET /auth/security-question?email= (público, retorna pergunta ou null); POST /auth/reset-password-security (público, valida resposta e troca a senha). public_user expõe security_question/has_security_question
- ✅ Resposta normalizada (trim + lowercase) — case-insensitive
- ✅ Frontend: link "Esqueci minha senha" no Login (modal 2 passos: e-mail → pergunta+resposta+nova senha); seção "Pergunta de segurança" no Perfil (5 perguntas pré-definidas)
- Validado: backend 10/10 (deep_testing_backend_v2)

## Bugfixes recebíveis + recorrência (2025-07)
- ✅ Confirmar recebimento de conta a receber agora gera lançamento de receita e credita a carteira escolhida (account_id); desfazer remove; excluir recebido remove a transação vinculada — backend verificado
- ✅ Editar recorrência NÃO duplica mais: materialize_recurrences idempotente (não recria mesma (recurrence_id,date)); PUT propaga mudanças aos lançamentos PENDENTES vinculados — backend verificado
- ✅ Removido bloco "Contas demonstrativas" da tela de login
- Script utilitário: /app/scripts/dedupe_recurrences.py (limpeza de duplicados antigos)

## Carteira em recorrência/parcelamento + bulk delete + transferência (2025-07)
- ✅ Recorrências: seletor de carteira (account_id já propagava ao lançamento materializado → debita/credita a carteira)
- ✅ Parcelamentos: seletor de carteira na criação e edição; saldo da carteira só é debitado quando a parcela é CONFIRMADA (paga); pendentes não afetam saldo e rolam para o mês seguinte; resumo "Total pendente / Total pago"
- ✅ GET /accounts: parcelas pagas deduzem do saldo da carteira vinculada (reabrir parcela devolve o saldo)
- ✅ Relatório anual: despesa mensal/anual passa a incluir parcelas (consistente com Dashboard)
- ✅ Bulk delete em Lançamentos: checkboxes + barra "Excluir selecionados" → POST /transactions/bulk-delete (parcelas vinculadas não selecionáveis)
- ✅ DELETE /recurrences/{id}: remove também os lançamentos FUTUROS (date > hoje) gerados pela recorrência; passados permanecem
- ✅ Transferência entre carteiras na página Carteiras (origem→destino, valor, data)
- Validado: backend 5/5 (deep_testing_backend_v2)

## Patrimônio + Performance da troca de mês (2026-06-25)
- ✅ Card "Patrimônio" no Painel: soma do saldo atual de todas as carteiras
- ✅ Performance: desativadas animações Recharts (Lines da evolução + Pie de categorias) que re-animavam a cada troca de mês — transição caiu de ~340ms/~1s para ~86ms (avg)
- Validado: iteration_9.json (Patrimônio €1.500 correto; troca de mês avg 86ms)

## Carteiras + Orçamento por mês + cards recolhíveis (2026-06-25)
- ✅ Carteiras (/carteiras): CRUD de contas/carteiras (corrente, poupança, dinheiro, cartão, investimento); saldo computado; atualizar valor guardado/investido (editar saldo); pagamentos/transferências ajustam o saldo; card de saldo total
- ✅ PUT/DELETE /accounts/{id} + tipo 'investment'
- ✅ Orçamento (/orcamento): seletor de mês/ano para visão futura (usa /dashboard?year&month)
- ✅ Cards recolhíveis com resumo em Recorrências (rec-toggle-card) e Grupos (group-toggle) — consistência com Parcelamentos
- ✅ Materialização de recorrências limitada a +12 meses (evita criar dezenas de transações ao navegar anos distantes)
- Validado: iteration_8.json (backend 8/8, UI completa)

## UX — Parcelamentos recolhíveis + Lançamentos enxuto (2026-06-25)
- ✅ Página Parcelamentos: cards recolhidos por padrão com resumo (próxima parcela n/X, valor, vencimento, faltam N); clique expande/recolhe
- ✅ Lançamentos: mostra só a parcela do mês visualizado + parcelas ATRASADAS pendentes (não as futuras distantes); selo "Atrasada" + linha destacada
- ✅ Confirmar pagamento da parcela direto em Lançamentos (botão pago → POST /installments/{id}/pay); parcela não paga permanece pendente nos meses seguintes até confirmada
- Validado: iteration_7.json (backend 3/3, UI 100%)

## Coerência cross-section — tudo linkado no mês (2026-06-25)
- ✅ Dashboard escopado por mês: Despesa do mês = transações(expense) + recorrências materializadas + parcelas de parcelamento com vencimento no mês; Saldo = receita - despesa abrangente (sobra real)
- ✅ Recebíveis no Dashboard escopados por mês (due_date < fim do mês; inclui vencidos, exclui futuros) — corrige "mostrava em todos os meses"
- ✅ Lançamentos unificado: GET /transactions mescla parcelas (source='installment', editable=false, "Descrição (n/total)", selo "Parcela") e recorrências (source='recurrence', selo "Recorrente"); linhas vinculadas são read-only ("vinculado")
- ✅ Recorrências materializam por mês visualizado (navegar mês futuro gera ocorrência 'pending')
- ✅ Novo campo installments_month_total no /dashboard
- Validado: iteration_6.json (backend 5/5, UI 7/7)

## Feature — Selo Recorrente + Média de gasto fixo (2026-06-25)
- ✅ Selo "Recorrente" nos Lançamentos (transações com recurrence_id/notes='(recorrente)')
- ✅ /dashboard retorna fixed_monthly_expense/fixed_monthly_income (normaliza weekly*52/12, monthly*1, yearly/12 das recorrências ativas) → card "Gasto fixo mensal" no Painel
- ✅ Página /recorrencias: resumo com Gasto fixo mensal, Receita fixa mensal e Saldo fixo estimado
- Validado: iteration_5.json (backend 4/4, UI 6/6)

## Bug fix — Recorrência futura no mês não aparecia na "Despesa do mês" (2026-06-25)
- Causa: materialize_recurrences usava horizonte = hoje; recorrências com vencimento futuro no mês corrente não eram geradas
- Correção: horizonte = último dia do mês atual; ocorrências <= hoje = "paid", futuras no mês = "pending" (ambas contam na despesa do mês)
- Validado: iteration_4.json (4/4 backend + UI, sem duplicação)

## Enhancements — Coerência saldo/metas (2026-06-24)
- ✅ Aportes de Metas podem gerar lançamento real: meta com conta vinculada (account_id) + aporte com from_account_id cria transferência (conta vinculada) ou despesa; mantém saldo coerente
- ✅ Resgate de Metas (POST /goals/{id}/withdraw): aporte negativo controlado (não passa do saldo da meta); com to_account_id devolve via transferência (da conta vinculada) ou receita — UI com botão "Resgatar" e diálogo
- ✅ Painel: cards "Minhas contas" com saldo por conta
- ✅ Lançamentos: filtro por conta (GET /transactions?account_id= cobre account_id/from/to)
- Validado via curl (aporte 300 + resgate 100 → saldos coerentes 1800/200; resgate>saldo=400) e smoke test UI

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

---
## Iteração — Melhorias Premium (Jun 2026, sessão de melhorias sobre app publicado)

Código importado do GitHub (ClementMarilia/Aura-Finance) para o ambiente. Backend .env configurado com JWT_SECRET + SEED_DEMO=true. `yarn install` executado (jspdf/recharts/etc.).

### Implementado (testado 100% backend+frontend, iteration_10.json)
1. **Menu mobile completo**: barra inferior com 4 abas primárias + botão "Mais" (data-testid=mobile-nav-more) que abre um Sheet (mobile-more-sheet) com TODAS as telas + Perfil/Configurações/Sair. (Layout.jsx)
2. **Frequências Trimestral + Semestral**: adicionadas em Recorrências e como opção "Repetir" no diálogo de Lançamentos. Backend: `_advance()` (+3/+6 meses), RecurrenceIn.frequency Literal, `_FREQ_FACTOR` do dashboard. (server.py, Recurrences.jsx, Transactions.jsx)
3. **Somente mês selecionado**: GET /transactions aceita `include_carryover` (default True, preserva comportamento antigo); frontend envia `false` → esconde itens de carry-over/atrasados de outros meses. (server.py, Transactions.jsx)
4. **Persistência do mês**: localStorage `aura_period` compartilhado entre Dashboard e Lançamentos. (Dashboard.jsx, Transactions.jsx)
5. **Refresh premium/minimalista (claro+escuro)**: tipografia Outfit (headings, mais leve) + Manrope (corpo/dados, tabular-nums); paleta refinada (creme/verde profundo claro; obsidiana/jade escuro); headers com glassmorphism; cards e labels refinados. (index.css, ThemeContext.js, Layout.jsx)

### Observações
- Anexos/comprovantes usam Emergent Object Storage — NÃO configurado neste ambiente (sem EMERGENT_LLM_KEY); upload de comprovante pode falhar (pré-existente, fora de escopo).
- Item LOW cosmético: data-testid do "Painel" é `*-home` (fallback) em vez de `*-painel` — não afeta funcionamento.

### Backlog / Próximos
- P2: alinhar testids `*-home` → `*-painel`.
- P2: configurar EMERGENT_LLM_KEY para reativar anexos.
- P2: aprofundar refino visual página a página (tabelas, badges) conforme design_guidelines.json.

---
## Iteração — Next Actions aplicadas (Jun 2026)

- **Anexos/comprovantes ATIVADOS**: adicionado EMERGENT_LLM_KEY ao backend/.env → Emergent Object Storage inicializa ("Object storage initialized"). Upload de comprovante (JPG/PNG/WEBP/GIF/PDF) validado end-to-end via API (retorna file_id + path). IA NÃO implementada (usuário optou por não usar por enquanto).
- **Refino visual premium (global, aditivo)** em index.css: números com tabular-nums (valores/saldos), hover sutil em linhas de tabela, foco premium (ring verde) em inputs/selects/textarea, feedback tátil (active:scale) nos botões primários, pills de status com borda sutil, cabeçalhos de tabela em peso 500 + tracking, scrollbar minimalista. Aplica-se a todas as telas (Lançamentos, Relatórios, Acertos, Carteiras, etc.).

Backlog atualizado:
- P2: alinhar testids `*-home` → `*-painel` (cosmético).
- P2 (opcional): resumo mensal inteligente com IA no Painel (usuário adiar).

---
## Iteração — Refino tela-a-tela + testids (Jun 2026) — testado 100% (iteration_11.json)

- **Barra de filtros de Lançamentos redesenhada**: header "Filtros" + grade rotulada (labels uppercase) com selects rounded-xl consistentes + botão "Limpar" (clear-filters-btn). Mesmos data-testids e lógica; comportamento "só o mês selecionado" preservado.
- **Cards de Relatórios (DeltaCard) redesenhados**: número em peso leve + tabular-nums, pill de variação percentual (verde/vermelho) e texto "vs ano anterior", hover com leve elevação.
- **Testids alinhados**: `nav-painel`, `mobile-nav-painel`, `more-nav-painel` (antes `*-home`).
- Regressão OK: novo lançamento, "Repetir" (recorrência), tema claro/escuro, navegação, upload/remover comprovante (Object Storage ativo).

---
## Iteração — Tela de Login redesenhada (Jun 2026) — testado 100% (iteration_12.json)

- **Login dark minimalista** (estilo referência SPACEFOX): fundo quase preto com brilho radial, wordmark "AURA" centralizado + logo mark, inputs com linha inferior (underline), botão "ENTRAR" full-width com borda, links "Esqueci minha senha" / "Criar conta" e círculo decorativo (spinner+check) embaixo.
- Lógica 100% preservada: login, falha de senha, recuperação por pergunta de segurança e cadastro. Todos os data-testids mantidos.
- Nota: inputs nativos com fundo transparente inline (evita overrides de `html.dark input`). Página de login é sempre dark, independente do tema do app.
