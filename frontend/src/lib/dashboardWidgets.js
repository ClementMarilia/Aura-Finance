export const DASHBOARD_WIDGETS = [
  { id: "balance_summary", label: "Resumo financeiro" },
  { id: "balance", label: "Resultado do mês" },
  { id: "income", label: "Receita do mês" },
  { id: "expense", label: "Despesa do mês" },
  { id: "pending_payable", label: "Contas pendentes" },
  { id: "receivable", label: "A receber" },
  { id: "future_installments", label: "Parcelas futuras" },
  { id: "fixed_monthly", label: "Gasto fixo mensal" },
  { id: "accounts", label: "Minhas contas" },
  { id: "evolution", label: "Fluxo de caixa (12 meses)" },
  { id: "categories", label: "Gastos por categoria" },
  { id: "goals", label: "Metas" },
  { id: "structure", label: "Estrutura das contas" },
  { id: "compare", label: "Comparativo com o ano anterior" },
  { id: "annual", label: "Visão anual" },
  { id: "insights", label: "Crelith Insights" },
  { id: "projection", label: "Projeção de saldo" },
  { id: "budget", label: "Orçamento 50/20/10/10/10" },
];

export const DEFAULT_DASHBOARD_WIDGETS = DASHBOARD_WIDGETS.map(({ id }) => id);
const SUPPORTED_WIDGETS = new Set(DEFAULT_DASHBOARD_WIDGETS);

export function normalizeDashboardWidgets(value) {
  if (!Array.isArray(value)) return [...DEFAULT_DASHBOARD_WIDGETS];
  return DEFAULT_DASHBOARD_WIDGETS.filter((id) => value.includes(id) && SUPPORTED_WIDGETS.has(id));
}

export function hasDashboardWidget(widgets, id) {
  return widgets.includes(id);
}
