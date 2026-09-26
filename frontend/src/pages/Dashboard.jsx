import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { fmtMoney, formatApiError } from "@/lib/api";
import { formatInsight, formatInsightEvidence, insightCategory } from "@/lib/insights";
import {
  DASHBOARD_WIDGETS, DEFAULT_DASHBOARD_WIDGETS,
  hasDashboardWidget, normalizeDashboardWidgets,
} from "@/lib/dashboardWidgets";
import { useAuth } from "@/context/AuthContext";
import { getMonthNames, translate as tr } from "@/i18n";
import { toast } from "sonner";
import {
  Lightbulb, AlertTriangle, Info, CheckCircle2, ChevronLeft, ChevronRight,
  ChevronDown, X, ThumbsUp, History, Settings2, RotateCcw
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area
} from "recharts";
import { monthForecast, monthOverMonth, splitAccounts, topCategories } from "@/lib/dashboardSummary";
import { useThemedColor } from "@/lib/colors";
import {
  AccountsCard, CashflowCard, CategoryCard, CommitmentsCard, ForecastHero, KpiTile,
} from "@/components/dashboard/DashboardBlocks";

const months = getMonthNames("short");
// Insights are the most verbose block; two are enough at a glance.
const INSIGHTS_PREVIEW = 2;

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [insights, setInsights] = useState(null);
  const [projection, setProjection] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [widgets, setWidgets] = useState(null);
  const [draftWidgets, setDraftWidgets] = useState([]);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [savingWidgets, setSavingWidgets] = useState(false);
  const [expandedInsight, setExpandedInsight] = useState(null);
  const [showInsightHistory, setShowInsightHistory] = useState(false);
  const [showAllInsights, setShowAllInsights] = useState(false);
  const themed = useThemedColor();
  const [insightHistory, setInsightHistory] = useState(null);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    try {
      const saved = JSON.parse(localStorage.getItem("aura_period"));
      if (saved?.year && saved?.month) return { year: +saved.year, month: +saved.month };
    } catch (_) {}
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  useEffect(() => {
    try { localStorage.setItem("aura_period", JSON.stringify({ year: period.year, month: period.month })); } catch (_) {}
  }, [period.year, period.month]);

  useEffect(() => {
    api.get("/dashboard", {
      params: { year: period.year, month: period.month },
    }).then(r => setData(r.data));
  }, [period.year, period.month]);

  useEffect(() => {
    api.get("/dashboard/preferences")
      .then((response) => setWidgets(normalizeDashboardWidgets(response.data?.widgets)))
      .catch(() => setWidgets([...DEFAULT_DASHBOARD_WIDGETS]));
  }, []);

  const now = new Date();
  const isCurrentPeriod = (
    period.year === now.getFullYear()
    && period.month === now.getMonth() + 1
  );

  useEffect(() => {
    if (!widgets) return;
    if (isCurrentPeriod && hasDashboardWidget(widgets, "insights")) {
      setInsights(null);
      api.get("/insights").then(r => setInsights(r.data || [])).catch(() => setInsights([]));
    } else {
      setInsights([]);
    }
  }, [isCurrentPeriod, user?.currency, widgets]);

  useEffect(() => {
    if (!widgets) return;
    if (hasDashboardWidget(widgets, "projection")) {
      api.get("/reports/projection", { params: { months: 6 } }).then(r => setProjection(r.data)).catch(() => {});
    } else {
      setProjection(null);
    }
    if (hasDashboardWidget(widgets, "accounts")) {
      api.get("/accounts").then(r => setAccounts(r.data || [])).catch(() => {});
    } else {
      setAccounts([]);
    }
  }, [user?.currency, widgets]);

  const openCustomizer = () => {
    setDraftWidgets([...(widgets || DEFAULT_DASHBOARD_WIDGETS)]);
    setCustomizerOpen(true);
  };

  const toggleDraftWidget = (widgetId, enabled) => {
    setDraftWidgets((current) => normalizeDashboardWidgets(
      enabled
        ? [...current, widgetId]
        : current.filter((id) => id !== widgetId)
    ));
  };

  const saveWidgetPreferences = async () => {
    setSavingWidgets(true);
    try {
      const response = await api.put("/dashboard/preferences", { widgets: draftWidgets });
      const saved = normalizeDashboardWidgets(response.data?.widgets);
      setWidgets(saved);
      setDraftWidgets(saved);
      setCustomizerOpen(false);
      toast.success(tr("Dashboard atualizado"));
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSavingWidgets(false);
    }
  };

  const dismissInsight = async (insightId) => {
    const previous = insights;
    setInsights((items) => (items || []).filter((item) => item.id !== insightId));
    try {
      await api.post(`/insights/${encodeURIComponent(insightId)}/dismiss`);
      setInsightHistory((items) => items?.map((entry) => (
        entry.insight_id === insightId ? { ...entry, status: "dismissed" } : entry
      )) ?? items);
    } catch (_) {
      setInsights(previous);
    }
  };

  const setInsightUseful = async (insightId, useful) => {
    const previous = insights;
    setInsights((items) => (items || []).map((item) => (
      item.id === insightId ? { ...item, useful } : item
    )));
    try {
      await api.put(`/insights/${encodeURIComponent(insightId)}/feedback`, { useful });
      setInsightHistory((items) => items?.map((entry) => (
        entry.insight_id === insightId
          ? { ...entry, status: useful ? "useful" : "not_useful" }
          : entry
      )) ?? items);
    } catch (_) {
      setInsights(previous);
    }
  };

  const toggleInsightHistory = async () => {
    const next = !showInsightHistory;
    setShowInsightHistory(next);
    if (next && insightHistory === null) {
      try {
        const response = await api.get("/insights/history", { params: { limit: 50 } });
        setInsightHistory(response.data || []);
      } catch (_) {
        setInsightHistory([]);
      }
    }
  };

  const curr = user?.currency || "EUR";
  const visibleInsights = showAllInsights ? (insights || []) : (insights || []).slice(0, INSIGHTS_PREVIEW);
  const ym = `year=${period.year}&month=${period.month}`;

  if (!data || !widgets) return <div className="text-[#6B7068]">{tr("Carregando painel...")}</div>;

  const forecast = monthForecast(data);
  const categorySummary = topCategories(data.category_breakdown, 5, tr("Outros"));
  const accountSummary = splitAccounts(accounts);
  const showForecast = hasDashboardWidget(widgets, "balance_summary");
  const pendingTo = `/lancamentos?type=expense&status=pending&${ym}`;

  // With the forecast visible, result / receivable / payable already live in
  // it, so their tiles are not repeated below.
  const tiles = [
    {
      id: "income", label: tr("Entradas"), value: data.income, tone: "text-emerald-600",
      delta: monthOverMonth(data.evolution, "income"), goodWhenUp: true,
      to: `/lancamentos?type=income&${ym}`,
    },
    {
      id: "expense", label: tr("Saídas"), value: data.expense, tone: "text-rose-600",
      delta: monthOverMonth(data.evolution, "expense"), goodWhenUp: false,
      to: `/lancamentos?type=expense&${ym}`,
    },
    ...(showForecast ? [] : [
      {
        id: "balance", label: tr("Resultado do mês"), value: data.balance,
        tone: data.balance < 0 ? "text-rose-600" : "text-[#061B4A]",
        hint: tr("Receitas − despesas do mês, incluindo pendentes"), to: "/extrato-financeiro",
      },
      {
        id: "pending_payable", label: tr("A pagar"), value: data.pending_payable, tone: "text-amber-700",
        hint: data.shared_payable > 0
          ? tr("Inclui {amount} de despesas compartilhadas", { amount: fmtMoney(data.shared_payable, curr) })
          : null,
        to: pendingTo,
      },
      {
        id: "receivable", label: tr("A receber"), value: data.receivable_total, tone: "text-blue-600",
        hint: data.shared_receivable > 0
          ? tr("Inclui {amount} de despesas compartilhadas", { amount: fmtMoney(data.shared_receivable, curr) })
          : null,
        to: "/contas-a-receber",
      },
    ]),
  ].filter((tile) => hasDashboardWidget(widgets, tile.id));

  const commitments = [
    {
      id: "future_installments", label: tr("Parcelas futuras"), value: data.future_installments_total || 0,
      to: "/parcelamentos", testId: "commitment-future-installments",
    },
    {
      id: "fixed_monthly", label: tr("Gasto fixo mensal"), value: data.fixed_monthly_expense || 0,
      hint: data.fixed_monthly_income > 0
        ? tr("Receita fixa: {amount}", { amount: fmtMoney(data.fixed_monthly_income, curr) })
        : tr("Média das recorrências ativas"),
      to: "/recorrencias", testId: "commitment-fixed-monthly",
    },
  ].filter((row) => hasDashboardWidget(widgets, row.id));

  const shiftMonth = (step) => {
    const index = period.year * 12 + (period.month - 1) + step;
    setPeriod({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  };

  const showAccounts = hasDashboardWidget(widgets, "accounts") && accounts.length > 0;
  const showCommitments = commitments.some((row) => row.value > 0);
  const hasSideColumn = showAccounts || showCommitments;

  return (
    <div className="space-y-4 md:space-y-6" data-testid="dashboard-root">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl" style={{ fontFamily: "Outfit" }}>
            {tr("Olá,")} {user?.name?.split(" ")[0]}
          </h1>
          <div className="mt-1 inline-flex items-center rounded-xl border border-[#E5E4E0] bg-white" data-testid="dashboard-period">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label={tr("Mês anterior")}
              data-testid="dashboard-prev-month"
              className="flex h-9 w-9 items-center justify-center rounded-l-xl text-[#6B7068] hover:bg-[#F1EFE7]">
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-[88px] px-1 text-center text-sm font-medium capitalize text-[#1A1C1A]" data-testid="dashboard-period-label">
              {months[period.month - 1]} {period.year}
            </span>
            <button type="button" onClick={() => shiftMonth(1)} aria-label={tr("Próximo mês")}
              data-testid="dashboard-next-month"
              className="flex h-9 w-9 items-center justify-center rounded-r-xl text-[#6B7068] hover:bg-[#F1EFE7]">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={openCustomizer}
          aria-label={tr("Personalizar")}
          className="inline-flex h-10 flex-shrink-0 items-center gap-2 rounded-xl border border-[#E5E4E0] bg-white px-3 text-sm font-medium text-[#061B4A] hover:bg-[#F8F7F3]"
          data-testid="dashboard-customize"
        >
          <Settings2 size={16} /> <span className="hidden sm:inline">{tr("Personalizar")}</span>
        </button>
      </div>

      <Dialog open={customizerOpen} onOpenChange={setCustomizerOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="dashboard-customizer">
          <DialogHeader>
            <DialogTitle>{tr("Personalizar dashboard")}</DialogTitle>
            <DialogDescription>
              {tr("Escolha os widgets que deseja visualizar. A configuração será salva na sua conta.")}
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-[#E5E4E0] rounded-xl border border-[#E5E4E0]">
            {DASHBOARD_WIDGETS.map((widget) => {
              const enabled = draftWidgets.includes(widget.id);
              return (
                <label key={widget.id} className="flex cursor-pointer items-center justify-between gap-4 p-3">
                  <span className="text-sm font-medium text-[#1A1C1A]">{tr(widget.label)}</span>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => toggleDraftWidget(widget.id, checked)}
                    className="data-[state=checked]:bg-[#1268F4] data-[state=unchecked]:bg-[#D6D3CA]"
                    aria-label={tr(widget.label)}
                    data-testid={`dashboard-widget-${widget.id}`}
                  />
                </label>
              );
            })}
          </div>
          <DialogFooter className="gap-2 sm:space-x-0">
            <button
              type="button"
              onClick={() => setDraftWidgets([...DEFAULT_DASHBOARD_WIDGETS])}
              disabled={savingWidgets}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E5E4E0] px-4 py-2 text-sm font-medium text-[#061B4A] hover:bg-[#F8F7F3] disabled:opacity-60"
              data-testid="dashboard-reset-widgets"
            >
              <RotateCcw size={15} /> {tr("Restaurar padrão")}
            </button>
            <button
              type="button"
              onClick={saveWidgetPreferences}
              disabled={savingWidgets}
              className="rounded-xl bg-[#061B4A] px-4 py-2 text-sm font-medium text-white hover:bg-[#0B2D73] disabled:opacity-60"
              data-testid="dashboard-save-widgets"
            >
              {savingWidgets ? tr("Salvando...") : tr("Salvar configuração")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {widgets.length === 0 && (
        <div className="card-soft py-12 text-center" data-testid="dashboard-empty-widgets">
          <Settings2 size={28} className="mx-auto text-[#6B7068]" />
          <h2 className="mt-3 text-lg font-semibold" style={{ fontFamily: "Outfit" }}>
            {tr("Seu dashboard está vazio")}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#6B7068]">
            {tr("Escolha pelo menos um widget para acompanhar suas finanças aqui.")}
          </p>
          <button type="button" onClick={openCustomizer}
            className="mt-4 rounded-xl bg-[#061B4A] px-4 py-2 text-sm font-medium text-white hover:bg-[#0B2D73]">
            {tr("Escolher widgets")}
          </button>
        </div>
      )}

      {(showForecast || tiles.length > 0 || hasSideColumn) && (
        <div className={`grid grid-cols-1 gap-4 md:gap-6 ${hasSideColumn ? "lg:grid-cols-3" : ""}`}>
          <div className={`space-y-4 ${hasSideColumn ? "lg:col-span-2" : ""}`}>
            {showForecast && (
              <ForecastHero forecast={forecast} currency={curr}
                receivableTo="/contas-a-receber" payableTo={pendingTo} />
            )}
            {tiles.length > 0 && (
              <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-2">
                {tiles.map((tile) => (
                  <KpiTile key={tile.id} {...tile} currency={curr} testId={`stat-${tile.id}`} />
                ))}
              </div>
            )}
          </div>
          {hasSideColumn && (
            <div className="space-y-4">
              {showAccounts && <AccountsCard summary={accountSummary} currency={curr} />}
              <CommitmentsCard rows={commitments} currency={curr} />
            </div>
          )}
        </div>
      )}

      {(hasDashboardWidget(widgets, "evolution") || hasDashboardWidget(widgets, "categories")) && (
        <div className={`grid grid-cols-1 gap-4 md:gap-6 ${
          hasDashboardWidget(widgets, "evolution") && hasDashboardWidget(widgets, "categories") ? "lg:grid-cols-3" : ""
        }`}>
          {hasDashboardWidget(widgets, "evolution") && (
            <div className={hasDashboardWidget(widgets, "categories") ? "lg:col-span-2" : ""}>
              <CashflowCard evolution={data.evolution} monthLabels={months} currency={curr} />
            </div>
          )}
          {hasDashboardWidget(widgets, "categories") && (
            <CategoryCard breakdown={categorySummary} currency={curr} to={`/lancamentos?type=expense&${ym}`} />
          )}
        </div>
      )}

      {/* Insights + Projection */}
      {(hasDashboardWidget(widgets, "insights") || hasDashboardWidget(widgets, "projection")) && (
      <div className={`grid grid-cols-1 gap-6 ${
        hasDashboardWidget(widgets, "insights") && hasDashboardWidget(widgets, "projection")
          ? "lg:grid-cols-2"
          : "lg:grid-cols-1"
      }`}>
        {hasDashboardWidget(widgets, "insights") && <div className="card-soft" data-testid="insights-section">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2" style={{ fontFamily: "Outfit" }}>
                <Lightbulb size={18} className="text-[#E5A83B]" /> {tr("Crelith Insights")}
              </h3>
              <p className="text-xs text-[#6B7068] mt-1">
                {tr("Análises automáticas baseadas nos seus próprios lançamentos.")}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleInsightHistory}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#061B4A]"
              aria-expanded={showInsightHistory}
              data-testid="insight-history-toggle"
            >
              <History size={14} /> {tr("Histórico")}
            </button>
          </div>
          <div className="space-y-3">
            {insights === null && <div className="text-sm text-[#6B7068]">{tr("Calculando insights...")}</div>}
            {!isCurrentPeriod && (
              <div className="text-sm text-[#6B7068]">
                {tr("As recomendações práticas são calculadas para o mês atual.")}
              </div>
            )}
            {isCurrentPeriod && insights?.length === 0 && (
              <div className="text-sm text-[#6B7068]">{tr("Nenhuma nova análise no momento.")}</div>
            )}
            {visibleInsights.map((ins, i) => {
              const map = {
                critical: { Icon: AlertTriangle, c: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200" },
                good: { Icon: CheckCircle2, c: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
                warning: { Icon: AlertTriangle, c: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
                opportunity: { Icon: Lightbulb, c: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200" },
                info: { Icon: Info, c: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
              };
              const { Icon, c, bg, border } = map[ins.severity] || map.info;
              const content = formatInsight(ins, curr);
              const evidence = formatInsightEvidence(ins, curr);
              const isExpanded = expandedInsight === ins.id;
              return (
                <div key={ins.id || i} className={`relative flex items-start gap-3 rounded-xl border p-3 ${border}`}
                  data-testid={`insight-${i}`}>
                  <div className={`w-8 h-8 rounded-lg ${bg} ${c} flex items-center justify-center flex-shrink-0`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 pr-6">
                    <div className={`text-[10px] font-semibold uppercase tracking-wide ${c}`}>
                      {insightCategory(ins.severity)}
                    </div>
                    <div className="text-sm font-medium text-[#1A1C1A] mt-0.5">{content.title}</div>
                    <div className="text-xs text-[#6B7068] mt-0.5">{content.message}</div>
                    {content.recommendation && (
                      <div className="mt-2 text-xs font-medium leading-relaxed text-[#1A1C1A]">
                        {content.recommendation}
                      </div>
                    )}
                    {content.impact && (
                      <div className="mt-1 text-[11px] text-[#6B7068]">{content.impact}</div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {ins.action_path && (
                        <Link to={ins.action_path} className="inline-flex items-center gap-1 text-xs font-medium text-[#1268F4] hover:underline">
                          {tr("Ver lançamentos")} <ChevronRight size={13} />
                        </Link>
                      )}
                      {evidence.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedInsight(isExpanded ? null : ins.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#6B7068] hover:text-[#1A1C1A]"
                          aria-expanded={isExpanded}
                        >
                          {tr("Por que estou vendo isso?")}
                          <ChevronDown size={13} className={isExpanded ? "rotate-180" : ""} />
                        </button>
                      )}
                      {ins.dismissible && (
                        <button
                          type="button"
                          onClick={() => setInsightUseful(ins.id, ins.useful !== true)}
                          className={`inline-flex items-center gap-1 text-xs font-medium ${
                            ins.useful ? "text-emerald-700" : "text-[#6B7068] hover:text-[#1A1C1A]"
                          }`}
                          aria-pressed={ins.useful === true}
                        >
                          <ThumbsUp size={13} fill={ins.useful ? "currentColor" : "none"} />
                          {ins.useful ? tr("Marcado como útil") : tr("Foi útil?")}
                        </button>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="mt-3 rounded-lg bg-[#F8F7F3] p-3" data-testid={`insight-evidence-${i}`}>
                        <div className="mb-2 text-[11px] font-semibold text-[#1A1C1A]">
                          {tr("Dados usados no cálculo")}
                        </div>
                        <dl className="space-y-1.5">
                          {evidence.map((entry, index) => (
                            <div key={`${entry.label}-${index}`} className="flex items-start justify-between gap-4 text-[11px]">
                              <dt className="text-[#6B7068]">{entry.label}</dt>
                              <dd className="text-right font-medium text-[#1A1C1A]">{entry.value}</dd>
                            </div>
                          ))}
                        </dl>
                        {ins.code === "savings_opportunity" && ins.data?.categories?.length > 0 && (
                          <div className="mt-3 border-t border-[#E5E4E0] pt-2 space-y-2">
                            {ins.data.categories.map((category) => (
                              <div key={category.category_id} className="text-[11px]">
                                <div className="font-medium text-[#1A1C1A]">{category.category}</div>
                                <div className="text-[#6B7068]">
                                  {tr("Atual: {current} · Período anterior: {previous} · Impacto mensal: {impact}", {
                                    current: fmtMoney(category.current_amount, curr),
                                    previous: fmtMoney(category.previous_amount, curr),
                                    impact: fmtMoney(category.monthly_impact, curr),
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {ins.dismissible && (
                    <button type="button" onClick={() => dismissInsight(ins.id)}
                      className="absolute right-2 top-2 p-1 rounded-md text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#1A1C1A]"
                      aria-label={tr("Ocultar sugestão")} title={tr("Ocultar sugestão")}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              );
            })}
            {(insights?.length || 0) > INSIGHTS_PREVIEW && (
              <button
                type="button"
                onClick={() => setShowAllInsights((value) => !value)}
                aria-expanded={showAllInsights}
                data-testid="insights-toggle-all"
                className="inline-flex min-h-[40px] items-center gap-1 text-xs font-medium text-[#1268F4]"
              >
                {showAllInsights
                  ? tr("Ver menos")
                  : tr("Ver mais ({count})", { count: insights.length - INSIGHTS_PREVIEW })}
                <ChevronDown size={14} className={showAllInsights ? "rotate-180" : ""} />
              </button>
            )}
            {showInsightHistory && (
              <div className="mt-4 border-t border-[#E5E4E0] pt-4" data-testid="insight-history">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7068]">
                  {tr("Insights apresentados e dispensados")}
                </div>
                {insightHistory === null && (
                  <div className="text-sm text-[#6B7068]">{tr("Carregando histórico...")}</div>
                )}
                {insightHistory?.length === 0 && (
                  <div className="text-sm text-[#6B7068]">{tr("O histórico ainda está vazio.")}</div>
                )}
                <div className="space-y-2">
                  {insightHistory?.map((entry) => {
                    const snapshot = entry.snapshot || {};
                    const content = formatInsight(snapshot, curr);
                    const statusLabel = {
                      presented: tr("Apresentado"),
                      useful: tr("Útil"),
                      not_useful: tr("Não útil"),
                      dismissed: tr("Dispensado"),
                    }[entry.status] || tr("Apresentado");
                    return (
                      <div key={entry.id || entry.insight_id} className="rounded-xl border border-[#E5E4E0] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-[#1A1C1A]">{content.title}</div>
                            <div className="mt-0.5 text-xs text-[#6B7068]">{content.message}</div>
                          </div>
                          <span className="rounded-full bg-[#F1EFE7] px-2 py-0.5 text-[10px] font-semibold text-[#6B7068]">
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>}

        {hasDashboardWidget(widgets, "projection") && <div className="card-soft" data-testid="projection-section">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>{tr("Projeção de saldo")}</h3>
            {projection && (
              <span className="text-xs text-[#6B7068]">
                {tr("média mensal:")} {fmtMoney(projection.avg_monthly_net, curr)}
              </span>
            )}
          </div>
          <p className="text-xs text-[#6B7068] mb-3">{tr("Estimativa para os próximos 6 meses com base no seu histórico.")}</p>
          {projection && (
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={projection.projection.map(p => ({ name: p.month.slice(5), projected: p.projected }))}>
                  <defs>
                    <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary-hover, #1268F4)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--primary-hover, #1268F4)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border, #E5E4E0)" />
                  <XAxis dataKey="name" stroke="var(--text-muted, #6B7068)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--text-muted, #6B7068)" fontSize={11} tickLine={false} axisLine={false} width={44} />
                  <Tooltip formatter={(v) => fmtMoney(v, curr)} />
                  <Area type="monotone" dataKey="projected" name="Saldo projetado" stroke="var(--primary, #061B4A)" strokeWidth={2} fill="url(#projGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>}
      </div>)}

      {/* Budget */}
      {hasDashboardWidget(widgets, "budget") && <div className="card-soft p-4 md:p-6" data-testid="dashboard-budget">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold" style={{ fontFamily: "Outfit" }}>{tr("Orçamento 50/20/10/10/10")}</h3>
          <div className="text-xs text-[#6B7068]">Base: {fmtMoney(data.budget.income, curr)}</div>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
          {data.budget.rules.map((r, i) => (
            <div key={r.label} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-[#1A1C1A]">{tr(r.label)} <span className="text-xs text-[#6B7068]">{r.percent}%</span></span>
                <span className="money-value whitespace-nowrap font-semibold text-[#1A1C1A]">{fmtMoney(r.amount, curr)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#F1EFE7]">
                <div className="h-full rounded-full"
                  style={{ width: `${r.percent}%`, backgroundColor: themed(["#061B4A","#D96C5B","#E5A83B","#7EA193","#C7BCA1"][i]) }} />
              </div>
            </div>
          ))}
        </div>
      </div>}
    </div>
  );
}
