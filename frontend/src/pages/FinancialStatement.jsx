import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Filter,
  RefreshCw,
  SlidersHorizontal,
  Wallet,
  X,
} from "lucide-react";
import api, { CURRENCIES, fmtDate, fmtMoney, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildPendingEntries,
  buildStatementEntries,
  filterStatementEntries,
  statementTotals,
} from "@/lib/financialStatement";
import { periodDateRange } from "@/lib/statementPeriod";
import { translate as tr } from "@/i18n";

const EMPTY_FILTERS = {
  account_id: "",
  start_date: "",
  end_date: "",
  direction: "",
  category_id: "",
  status: "",
  currency: "",
};

const PERIOD_PRESETS = [
  { value: "all", label: "Todo período" },
  { value: "today", label: "Hoje" },
  { value: "this_month", label: "Este mês" },
  { value: "last_30_days", label: "30 dias" },
  { value: "last_6_months", label: "6 meses" },
  { value: "this_year", label: "Este ano" },
  { value: "custom", label: "Personalizado" },
];

const DIRECTION_LABELS = {
  income: "Entrada",
  expense: "Saída",
  transfer: "Transferência",
  adjustment: "Conciliação",
  initial_balance: "Saldo inicial",
};

const STATUS_LABELS = {
  paid: "Pago",
  pending: "Pendente",
  cancelled: "Cancelado",
};

function FilterChip({ children, onRemove }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1.5 rounded-full border border-[#D8E5FF] bg-[#EEF4FF] px-3 py-1.5 text-xs font-medium text-[#0D5DD7] transition hover:border-[#1268F4]"
    >
      {children}
      <X size={13} aria-hidden="true" />
    </button>
  );
}

function DirectionIcon({ direction }) {
  if (direction === "income") return <ArrowUpRight size={17} />;
  if (direction === "expense") return <ArrowDownRight size={17} />;
  if (direction === "transfer") return <ArrowLeftRight size={17} />;
  return <CircleDollarSign size={17} />;
}

function MovementList({ rows, categories, baseCurrency, pending = false }) {
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-dashed border-[#D8D7D2] px-4 py-10 text-center text-sm text-[#6B7068]">
        {tr(pending ? "Nenhum item pendente para os filtros selecionados" : "Nenhum movimento para os filtros selecionados")}
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#E5E4E0] overflow-hidden rounded-2xl border border-[#E5E4E0] bg-white">
      {rows.map(entry => {
        const positive = Number(entry.amount || 0) >= 0;
        const category = categories[entry.category_id];
        return (
          <div
            key={`${entry.source || "movement"}-${entry.id}-${entry.account_id}`}
            className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_140px_150px] md:items-center"
            data-testid={`statement-entry-${entry.id}`}
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                positive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"
              }`}>
                <DirectionIcon direction={entry.direction} />
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium text-[#061B4A]">
                  {tr(entry.description || "Lançamento sem descrição")}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#6B7068]">
                  <span>{fmtDate(entry.date)}</span>
                  <span>•</span>
                  <span>{tr(entry.account_name || "Carteira")}</span>
                  {category && <><span>•</span><span>{tr(category.name)}</span></>}
                  <span className="rounded-full bg-[#F1EFE7] px-2 py-0.5">
                    {tr(DIRECTION_LABELS[entry.direction] || entry.direction)}
                  </span>
                  {pending && (
                    <span className={`rounded-full px-2 py-0.5 ${
                      entry.status === "cancelled"
                        ? "bg-slate-100 text-slate-600"
                        : "bg-amber-50 text-amber-700"
                    }`}>
                      {tr(STATUS_LABELS[entry.status] || entry.status)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-sm md:text-right">
              <p className="text-xs text-[#6B7068]">
                {pending ? tr("Não altera o saldo") : tr("Saldo após movimento")}
              </p>
              <p className="font-medium text-[#061B4A]">
                {pending ? "—" : fmtMoney(entry.running_balance, entry.currency)}
              </p>
            </div>

            <div className="md:text-right">
              <p className={`font-semibold ${positive ? "text-emerald-700" : "text-rose-600"}`}>
                {positive ? "+" : ""}{fmtMoney(entry.amount, entry.currency)}
              </p>
              {entry.currency !== baseCurrency && entry.base_amount !== null && (
                <p className="text-xs text-[#6B7068]">
                  ≈ {entry.base_amount > 0 ? "+" : ""}{fmtMoney(entry.base_amount, baseCurrency)}
                </p>
              )}
              {entry.base_amount === null && (
                <p className="text-xs text-amber-700">{tr("Conversão indisponível")}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function FinancialStatement() {
  const { user } = useAuth();
  const baseCurrency = user?.currency || "EUR";
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [entries, setEntries] = useState([]);
  const [pendingEntries, setPendingEntries] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [periodPreset, setPeriodPreset] = useState("all");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [accountsResponse, categoriesResponse, transactionsResponse] = await Promise.all([
        api.get("/accounts"),
        api.get("/categories"),
        api.get("/transactions"),
      ]);
      const nextAccounts = accountsResponse.data || [];
      const breakdownResponses = await Promise.all(
        nextAccounts.map(account => api.get(`/accounts/${account.id}/balance-breakdown`)),
      );
      setAccounts(nextAccounts);
      setCategories(categoriesResponse.data || []);
      setEntries(buildStatementEntries(
        nextAccounts,
        breakdownResponses.map(response => response.data),
        baseCurrency,
      ));
      setPendingEntries(buildPendingEntries(
        transactionsResponse.data || [],
        nextAccounts,
        baseCurrency,
      ));
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [baseCurrency]);

  useEffect(() => { load(); }, [load]);

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map(category => [category.id, category])),
    [categories],
  );
  const selectedAccounts = accounts.filter(account => (
    (!filters.account_id || account.id === filters.account_id)
    && (!filters.currency || (account.currency || baseCurrency) === filters.currency)
  ));
  const currentBalance = selectedAccounts.reduce(
    (sum, account) => sum + Number(account.balance_base ?? account.balance ?? 0),
    0,
  );
  const paidRows = filters.status && filters.status !== "paid"
    ? []
    : filterStatementEntries(entries, filters);
  const nonPaidRows = filters.status === "paid"
    ? []
    : filterStatementEntries(pendingEntries, filters)
      .filter(entry => !filters.status || entry.status === filters.status);
  const totals = statementTotals(paidRows);
  const hasFilters = Object.values(filters).some(Boolean);
  const advancedFilterCount = [
    filters.account_id,
    filters.direction,
    filters.category_id,
    filters.status,
    filters.currency,
  ].filter(Boolean).length;
  const periodLabel = PERIOD_PRESETS.find(preset => preset.value === periodPreset)?.label;
  const selectedAccount = accounts.find(account => account.id === filters.account_id);
  const selectedCategory = categories.find(category => category.id === filters.category_id);

  const selectPeriod = preset => {
    setPeriodPreset(preset);
    if (preset !== "custom") {
      setFilters(current => ({ ...current, ...periodDateRange(preset) }));
    }
  };

  const setFilter = (name, value) => {
    setFilters(current => ({ ...current, [name]: value }));
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPeriodPreset("all");
    setShowMoreFilters(false);
  };

  if (loading) {
    return <div className="text-[#6B7068]">{tr("Carregando extrato financeiro...")}</div>;
  }

  return (
    <div className="space-y-6" data-testid="financial-statement-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>
            {tr("Extrato financeiro")}
          </h1>
          <p className="mt-1 text-[#6B7068]">
            {tr("Veja de onde veio o saldo e acompanhe tudo que entrou e saiu")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={load} className="rounded-xl">
            <RefreshCw size={16} className="mr-1.5" /> {tr("Atualizar")}
          </Button>
          <Button asChild className="rounded-xl bg-[#061B4A] hover:bg-[#1268F4]">
            <Link to="/carteiras">
              <Wallet size={16} className="mr-1.5" /> {tr("Gerenciar carteiras")}
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl bg-gradient-to-br from-[#061B4A] to-[#1268F4] p-5 text-white">
        <p className="text-sm uppercase tracking-wide opacity-75">{tr("Memória do cálculo")}</p>
        <p className="mt-2 text-sm sm:text-base">
          {tr("Saldo inicial + Entradas − Saídas ± Transferências ± Ajustes = Saldo atual")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card-soft p-4 sm:p-5">
          <p className="text-sm text-[#6B7068]">{tr("Saldo atual")}</p>
          <p className={`money-value mt-1 text-xl font-semibold sm:text-2xl ${currentBalance < 0 ? "text-rose-600" : "text-[#061B4A]"}`}>
            {fmtMoney(currentBalance, baseCurrency)}
          </p>
        </div>
        <div className="card-soft p-4 sm:p-5">
          <p className="text-sm text-[#6B7068]">{tr("Entradas no período")}</p>
          <p className="money-value mt-1 text-xl font-semibold text-emerald-700 sm:text-2xl">
            {fmtMoney(totals.income, baseCurrency)}
          </p>
        </div>
        <div className="card-soft p-4 sm:p-5">
          <p className="text-sm text-[#6B7068]">{tr("Saídas no período")}</p>
          <p className="money-value mt-1 text-xl font-semibold text-rose-600 sm:text-2xl">
            {fmtMoney(totals.expense, baseCurrency)}
          </p>
        </div>
      </div>

      <div className="card-soft space-y-4" data-testid="statement-filters">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-semibold text-[#061B4A]">
              <CalendarDays size={18} /> {tr("Período")}
            </div>
            <p className="mt-0.5 text-xs text-[#6B7068]">
              {tr("Escolha um intervalo rápido ou personalize as datas")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-[#4F554D]">
              <Filter size={15} />
              {tr("{count} movimentos", { count: paidRows.length + nonPaidRows.length })}
            </div>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-sm font-medium text-[#1268F4] hover:underline"
              >
                {tr("Limpar filtros")}
              </button>
            )}
          </div>
        </div>

        <div
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          role="group"
          aria-label={tr("Período do extrato")}
          data-testid="statement-period-presets"
        >
          {PERIOD_PRESETS.map(preset => (
            <button
              key={preset.value}
              type="button"
              onClick={() => selectPeriod(preset.value)}
              aria-pressed={periodPreset === preset.value}
              className={`shrink-0 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
                periodPreset === preset.value
                  ? "border-[#1268F4] bg-[#1268F4] text-white shadow-sm"
                  : "border-[#D8D7D2] bg-white text-[#4F554D] hover:border-[#1268F4] hover:text-[#1268F4]"
              }`}
            >
              {tr(preset.label)}
            </button>
          ))}
        </div>

        {periodPreset === "custom" && (
          <div className="grid gap-3 rounded-2xl border border-[#E5E4E0] bg-[#FAFAF8] p-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-[#6B7068]">
              <span className="flex items-center gap-1"><CalendarDays size={13} /> {tr("Data inicial")}</span>
              <Input
                type="date"
                value={filters.start_date}
                onChange={event => setFilter("start_date", event.target.value)}
                data-testid="statement-start-date"
              />
            </label>
            <label className="space-y-1 text-xs text-[#6B7068]">
              <span className="flex items-center gap-1"><CalendarDays size={13} /> {tr("Data final")}</span>
              <Input
                type="date"
                value={filters.end_date}
                onChange={event => setFilter("end_date", event.target.value)}
                data-testid="statement-end-date"
              />
            </label>
          </div>
        )}

        <div className="border-t border-[#E5E4E0] pt-4">
          <button
            type="button"
            onClick={() => setShowMoreFilters(current => !current)}
            aria-expanded={showMoreFilters}
            className="flex w-full items-center justify-between gap-3 text-left"
            data-testid="statement-more-filters"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-[#061B4A]">
              <SlidersHorizontal size={17} />
              {tr("Mais filtros")}
              {advancedFilterCount > 0 && (
                <span className="rounded-full bg-[#1268F4] px-2 py-0.5 text-xs text-white">
                  {advancedFilterCount}
                </span>
              )}
            </span>
            <ChevronDown
              size={18}
              className={`text-[#6B7068] transition-transform ${showMoreFilters ? "rotate-180" : ""}`}
            />
          </button>

          {showMoreFilters && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="space-y-1 text-xs text-[#6B7068]">
                <span>{tr("Carteira")}</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={filters.account_id}
                  onChange={event => setFilter("account_id", event.target.value)}
                  data-testid="statement-account-filter">
                  <option value="">{tr("Todas as carteiras")}</option>
                  {accounts.map(account => (
                    <option key={account.id} value={account.id}>{tr(account.name)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-[#6B7068]">
                <span>{tr("Movimento")}</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={filters.direction}
                  onChange={event => setFilter("direction", event.target.value)}
                  data-testid="statement-direction-filter">
                  <option value="">{tr("Todos os movimentos")}</option>
                  {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{tr(label)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-[#6B7068]">
                <span>{tr("Categoria")}</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={filters.category_id}
                  onChange={event => setFilter("category_id", event.target.value)}
                  data-testid="statement-category-filter">
                  <option value="">{tr("Todas as categorias")}</option>
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>{tr(category.name)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-[#6B7068]">
                <span>{tr("Status")}</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={filters.status}
                  onChange={event => setFilter("status", event.target.value)}
                  data-testid="statement-status-filter">
                  <option value="">{tr("Todos os status")}</option>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{tr(label)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-[#6B7068]">
                <span>{tr("Moeda")}</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={filters.currency}
                  onChange={event => setFilter("currency", event.target.value)}
                  data-testid="statement-currency-filter">
                  <option value="">{tr("Todas as moedas")}</option>
                  {CURRENCIES.map(currency => (
                    <option key={currency.value} value={currency.value}>{currency.label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {(periodPreset !== "all" || advancedFilterCount > 0) && (
          <div className="flex flex-wrap items-center gap-2" data-testid="statement-active-filters">
            <span className="text-xs font-medium text-[#6B7068]">{tr("Filtros ativos")}:</span>
            {periodPreset !== "all" && (
              <FilterChip onRemove={() => selectPeriod("all")}>{tr(periodLabel)}</FilterChip>
            )}
            {filters.account_id && (
              <FilterChip onRemove={() => setFilter("account_id", "")}>
                {tr(selectedAccount?.name || "Carteira")}
              </FilterChip>
            )}
            {filters.direction && (
              <FilterChip onRemove={() => setFilter("direction", "")}>
                {tr(DIRECTION_LABELS[filters.direction])}
              </FilterChip>
            )}
            {filters.category_id && (
              <FilterChip onRemove={() => setFilter("category_id", "")}>
                {tr(selectedCategory?.name || "Categoria")}
              </FilterChip>
            )}
            {filters.status && (
              <FilterChip onRemove={() => setFilter("status", "")}>
                {tr(STATUS_LABELS[filters.status])}
              </FilterChip>
            )}
            {filters.currency && (
              <FilterChip onRemove={() => setFilter("currency", "")}>{filters.currency}</FilterChip>
            )}
          </div>
        )}
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold text-[#061B4A]" style={{ fontFamily: "Outfit" }}>
            {tr("Movimentos que alteraram o saldo")}
          </h2>
          <p className="text-sm text-[#6B7068]">
            {tr("O saldo acumulado é calculado separadamente para cada carteira")}
          </p>
        </div>
        <MovementList rows={paidRows} categories={categoryMap} baseCurrency={baseCurrency} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold text-[#061B4A]" style={{ fontFamily: "Outfit" }}>
            {tr("Itens que ainda não alteraram o saldo")}
          </h2>
          <p className="text-sm text-[#6B7068]">
            {tr("Pendentes e cancelados aparecem separados do saldo disponível")}
          </p>
        </div>
        <MovementList
          rows={nonPaidRows}
          categories={categoryMap}
          baseCurrency={baseCurrency}
          pending
        />
      </section>
    </div>
  );
}
