import { useEffect, useState } from "react";
import api, { fmtDate, fmtMoney } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { exportCSV, exportPDF, exportMonthlyReportPDF } from "@/lib/exporters";
import { getMonthNames, translate as tr } from "@/i18n";
import {
  ArrowDownRight, ArrowUpRight, CalendarDays, CircleDollarSign, CreditCard,
  FileDown, FileText, Landmark, ReceiptText, Repeat, TrendingDown, TrendingUp,
  Wallet,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from "recharts";

const MONTHS = getMonthNames("short");
const MONTHS_LONG = getMonthNames("long");
const STATUS = { paid: tr("Pago"), pending: tr("Pendente"), cancelled: tr("Cancelado") };
const SOURCE = { manual: "Manual", recurrence: "Recorrência", installment: tr("Parcela") };

function DeltaPill({ comparison, invert = false, label = "mês anterior" }) {
  if (!comparison || comparison.difference === 0) {
    return <span className="text-xs text-[#6B7068]">igual ao {label}</span>;
  }
  const up = comparison.difference > 0;
  const good = invert ? !up : up;
  const percent = comparison.percent == null ? "—" : `${Math.abs(comparison.percent)}%`;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {percent} vs {label}
    </span>
  );
}

function SummaryCard({ label, value, currency, icon: Icon, tone, comparison, invert, comparisonLabel }) {
  const tones = {
    green: "text-emerald-600 bg-emerald-50",
    red: "text-rose-600 bg-rose-50",
    amber: "text-amber-700 bg-amber-50",
    primary: "text-[#061B4A] bg-[#F1EFE7]",
  };
  return (
    <div className="card-soft hover:shadow-md hover:-translate-y-0.5 transition-[box-shadow,transform] duration-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="stat-label">{label}</div>
          <div className={`text-3xl font-light tracking-tight tabular-nums mt-2 ${tone === "red" ? "text-rose-600" : tone === "green" ? "text-emerald-600" : ""}`} style={{ fontFamily: "Outfit" }}>
            {fmtMoney(value, currency)}
          </div>
        </div>
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${tones[tone] || tones.primary}`}>
          <Icon size={18} />
        </span>
      </div>
      {comparison && <div className="mt-3"><DeltaPill comparison={comparison} invert={invert} label={comparisonLabel} /></div>}
    </div>
  );
}

function AnnualDeltaCard({ label, value, prev, currency, invert }) {
  return (
    <SummaryCard
      label={label}
      value={value}
      currency={currency}
      icon={invert ? TrendingDown : TrendingUp}
      tone={invert ? "red" : "green"}
      invert={invert}
      comparisonLabel="ano anterior"
      comparison={{ difference: value - prev, percent: prev ? ((value - prev) / Math.abs(prev)) * 100 : value ? 100 : null }}
    />
  );
}

function InsightCard({ icon: Icon, label, value, detail, tone = "primary" }) {
  const toneClass = tone === "red" ? "text-rose-600 bg-rose-50" : tone === "amber" ? "text-amber-700 bg-amber-50" : "text-[#061B4A] bg-[#F1EFE7]";
  return (
    <div className="card-soft p-5">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${toneClass}`}><Icon size={17} /></div>
      <div className="stat-label mt-4">{label}</div>
      <div className="text-xl font-medium mt-1 tabular-nums" style={{ fontFamily: "Outfit" }}>{value}</div>
      {detail && <div className="text-xs text-[#6B7068] mt-1">{detail}</div>}
    </div>
  );
}

function MovementColumn({ title, items, type, currency }) {
  const income = type === "income";
  return (
    <div className="card-soft p-0 overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E5E4E0] flex items-center justify-between">
        <div className="flex items-center gap-2">
          {income ? <ArrowUpRight size={18} className="text-emerald-600" /> : <ArrowDownRight size={18} className="text-rose-600" />}
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
        <span className="text-xs text-[#6B7068]">{items.length} {tr("itens")}</span>
      </div>
      <div className="divide-y divide-[#E5E4E0] max-h-[460px] overflow-y-auto">
        {items.length === 0 && <div className="p-8 text-sm text-center text-[#6B7068]">{tr("Nenhum lançamento no período.")}</div>}
        {items.map(item => (
          <div key={`${item.source}-${item.id}`} className="p-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium truncate">{item.description || tr("Sem descrição")}</div>
              <div className="text-xs text-[#6B7068] mt-1 flex flex-wrap gap-x-2 gap-y-1">
                <span>{fmtDate(item.date)}</span><span>•</span><span>{item.category}</span><span>•</span>
                <span>{SOURCE[item.source] || item.source}</span>
                {item.is_installment && item.installment_number && <span>({item.installment_number}/{item.installment_total})</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className={`font-semibold tabular-nums ${income ? "text-emerald-600" : "text-rose-600"}`}>
                {income ? "+" : "−"}{fmtMoney(item.base_amount, currency)}
              </div>
              <span className={`pill mt-1 ${item.status === "paid" ? "pill-paid" : "pill-pending"}`}>{STATUS[item.status] || item.status}</span>
              {item.currency !== currency && (
                <div className="text-[10px] text-[#6B7068] mt-1">{tr("Original:")} {fmtMoney(item.amount, item.currency)}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const now = new Date();
  const savedPeriod = (() => {
    try { return JSON.parse(localStorage.getItem("aura_period")) || {}; } catch (_) { return {}; }
  })();
  const [view, setView] = useState("monthly");
  const [period, setPeriod] = useState({
    year: Number(savedPeriod.year) || now.getFullYear(),
    month: Number(savedPeriod.month) || now.getMonth() + 1,
  });
  const [annualYear, setAnnualYear] = useState(now.getFullYear());
  const [monthly, setMonthly] = useState(null);
  const [annual, setAnnual] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const currency = user?.currency || "EUR";
  const years = Array.from({ length: 5 }, (_, index) => now.getFullYear() - 2 + index);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const request = view === "monthly"
      ? api.get("/reports/monthly", { params: { year: period.year, month: period.month } })
      : api.get("/reports/annual", { params: { year: annualYear } });
    request.then(response => {
      if (!active) return;
      if (view === "monthly") setMonthly(response.data);
      else setAnnual(response.data);
    }).catch(() => {
      if (active) setError(tr("Não foi possível carregar o relatório. Tente novamente."));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [view, period.year, period.month, annualYear, user?.currency]);

  useEffect(() => {
    try { localStorage.setItem("aura_period", JSON.stringify(period)); } catch (_) {}
  }, [period]);

  const exportMonthlyCSV = () => {
    const rows = [...monthly.entries, ...monthly.expenses]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(item => [
        item.type === "income" ? "Entrada" : tr("Saída"), item.date,
        item.description || tr("Sem descrição"), item.category,
        SOURCE[item.source] || item.source, STATUS[item.status] || item.status,
        item.amount, item.currency, item.base_amount, monthly.base_currency,
      ]);
    exportCSV(
      `relatorio_mensal_${period.year}_${String(period.month).padStart(2, "0")}.csv`,
      [tr("Tipo"), tr("Data"), tr("Descrição"), tr("Categoria"), tr("Origem"), tr("Status"), "Valor original", "Moeda original", "Valor convertido", tr("Moeda-base")],
      rows,
    );
  };

  const exportAnnualCSV = () => exportCSV(
    `relatorio_${annualYear}.csv`,
    [tr("Mês"), `Receita ${annualYear}`, `Despesa ${annualYear}`, `Saldo ${annualYear}`, `Despesa ${annual.prev_year}`],
    annual.months.map(month => [
      MONTHS[month.month - 1], month.income, month.expense, month.balance,
      annual.prev_months[month.month - 1]?.expense || 0,
    ]),
  );

  const exportAnnualPDF = () => exportPDF(
    `Relatório Anual ${annualYear}`,
    `Comparativo com ${annual.prev_year} — gerado para ${user?.name}`,
    [tr("Mês"), tr("Receita"), tr("Despesa"), tr("Saldo")],
    annual.months.map(month => [
      MONTHS[month.month - 1], fmtMoney(month.income, currency),
      fmtMoney(month.expense, currency), fmtMoney(month.balance, currency),
    ]),
    [tr("Total"), fmtMoney(annual.totals.income, currency), fmtMoney(annual.totals.expense, currency), fmtMoney(annual.totals.balance, currency)],
  );

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{tr("Relatórios")}</h1>
          <p className="text-[#6B7068] mt-1">{tr("Leitura executiva e detalhada da sua vida financeira.")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="p-1 rounded-xl bg-[#F1EFE7] flex" data-testid="reports-view-switch">
            <button onClick={() => setView("monthly")} className={`px-3 py-1.5 rounded-lg text-sm transition ${view === "monthly" ? "bg-white shadow-sm font-medium" : "text-[#6B7068]"}`}>{tr("Mensal")}</button>
            <button onClick={() => setView("annual")} className={`px-3 py-1.5 rounded-lg text-sm transition ${view === "annual" ? "bg-white shadow-sm font-medium" : "text-[#6B7068]"}`}>{tr("Anual")}</button>
          </div>
          <Button variant="outline" disabled={loading || (view === "monthly" ? !monthly : !annual)} onClick={view === "monthly" ? exportMonthlyCSV : exportAnnualCSV} data-testid="export-csv-btn" className="rounded-xl">
            <FileDown size={16} className="mr-1" /> {tr("CSV")}
          </Button>
          <Button variant="outline" disabled={loading || (view === "monthly" ? !monthly : !annual)} onClick={view === "monthly" ? () => exportMonthlyReportPDF(monthly, user?.name) : exportAnnualPDF} data-testid="export-pdf-btn" className="rounded-xl">
            <FileText size={16} className="mr-1" /> {tr("PDF")}
          </Button>
        </div>
      </div>

      <div className="card-soft py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-medium"><CalendarDays size={17} className="text-[#061B4A]" /> {tr("Período do relatório")}</div>
        <div className="flex gap-2">
          {view === "monthly" && (
            <select value={period.month} onChange={event => setPeriod({ ...period, month: Number(event.target.value) })} data-testid="reports-month-select" className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
              {MONTHS_LONG.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
            </select>
          )}
          <select value={view === "monthly" ? period.year : annualYear} onChange={event => view === "monthly" ? setPeriod({ ...period, year: Number(event.target.value) }) : setAnnualYear(Number(event.target.value))} data-testid="reports-year-select" className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
            {years.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
      </div>

      {loading && <div className="card-soft text-sm text-[#6B7068]">{tr("Carregando relatório...")}</div>}
      {error && <div className="card-soft border-rose-200 text-rose-600">{error}</div>}
      {!loading && !error && view === "monthly" && monthly && <MonthlyReport data={monthly} currency={monthly.base_currency || currency} />}
      {!loading && !error && view === "annual" && annual && <AnnualReport data={annual} currency={annual.base_currency || currency} />}
    </div>
  );
}

function MonthlyReport({ data, currency }) {
  const summary = data.summary;
  const profile = data.expense_profile;
  const composition = [
    { name: tr("Fixos"), value: profile.fixed, color: "#061B4A" },
    { name: tr("Variáveis"), value: profile.variable, color: "#D96C5B" },
    { name: tr("Parcelas"), value: profile.installments, color: "#E5A83B" },
  ].filter(item => item.value > 0);
  const previous = data.previous_month?.summary || {};

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard label={tr("Entradas")} value={summary.income} currency={currency} icon={ArrowUpRight} tone="green" comparison={data.comparison.income} />
        <SummaryCard label={tr("Saídas")} value={summary.expense} currency={currency} icon={ArrowDownRight} tone="red" comparison={data.comparison.expense} invert />
        <SummaryCard label={summary.balance_status === "negative" ? "Saldo negativo" : tr("Saldo do mês")} value={summary.balance} currency={currency} icon={Wallet} tone={summary.balance < 0 ? "red" : "primary"} comparison={data.comparison.balance} />
        <SummaryCard label="Saldo realizado" value={summary.realized_balance} currency={currency} icon={Landmark} tone={summary.realized_balance < 0 ? "red" : "primary"} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <InsightCard icon={ReceiptText} label="Maior gasto" value={data.largest_expense ? fmtMoney(data.largest_expense.base_amount, currency) : "—"} detail={data.largest_expense?.description || tr("Sem despesas no mês")} tone="red" />
        <InsightCard icon={CircleDollarSign} label={tr("Categoria líder")} value={data.top_category?.category || "—"} detail={data.top_category ? `${fmtMoney(data.top_category.amount, currency)} · ${data.top_category.percent}% das saídas` : tr("Sem despesas no mês")} />
        <InsightCard icon={TrendingUp} label={tr("Taxa de economia")} value={summary.savings_rate == null ? "—" : `${summary.savings_rate}%`} detail={summary.savings_rate == null ? "Sem entradas para calcular" : "Percentual que restou das entradas"} />
        <InsightCard icon={CreditCard} label={tr("Saídas pendentes")} value={fmtMoney(summary.pending_expense, currency)} detail={`${fmtMoney(summary.paid_expense, currency)} já pagos`} tone="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-soft">
          <h3 className="text-lg font-semibold">{tr("Perfil das saídas")}</h3>
          <p className="text-xs text-[#6B7068] mt-1">{tr("Fixos, variáveis e compras parceladas.")}</p>
          {composition.length ? (
            <div style={{ width: "100%", height: 270 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={composition} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>
                    {composition.map(item => <Cell key={item.name} fill={item.color} />)}
                  </Pie>
                  <Tooltip formatter={value => fmtMoney(value, currency)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="h-[270px] flex items-center justify-center text-sm text-[#6B7068]">{tr("Sem saídas no período.")}</div>}
        </div>
        <div className="card-soft">
          <h3 className="text-lg font-semibold">{tr("Gastos por categoria")}</h3>
          <p className="text-xs text-[#6B7068] mt-1">{tr("Participação de cada categoria nas saídas.")}</p>
          {data.category_breakdown.length ? (
            <div style={{ width: "100%", height: 270 }}>
              <ResponsiveContainer>
                <BarChart data={data.category_breakdown} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E4E0" horizontal={false} />
                  <XAxis type="number" tickFormatter={value => fmtMoney(value, currency)} fontSize={11} />
                  <YAxis type="category" dataKey="category" width={96} fontSize={11} />
                  <Tooltip formatter={value => fmtMoney(value, currency)} />
                  <Bar dataKey="amount" name="Gasto" fill="#D96C5B" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="h-[270px] flex items-center justify-center text-sm text-[#6B7068]">{tr("Sem categorias para exibir.")}</div>}
        </div>
      </div>

      <div className="card-soft py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="stat-label">{tr("Comparação rápida")}</div>
          <div className="font-medium mt-1">{tr("Mês anterior:")} {fmtMoney(previous.balance || 0, currency)} {tr("de saldo")}</div>
        </div>
        <div className="text-sm text-[#6B7068]">{summary.transaction_count} movimentações consideradas · transferências não alteram receitas ou despesas</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MovementColumn title={tr("Entradas")} items={data.entries} type="income" currency={currency} />
        <MovementColumn title={tr("Saídas")} items={data.expenses} type="expense" currency={currency} />
      </div>
    </>
  );
}

function AnnualReport({ data, currency }) {
  const chartData = data.months.map((month, index) => ({
    name: MONTHS[month.month - 1], income: month.income, expense: month.expense,
    prevExpense: data.prev_months[index]?.expense || 0,
  }));
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AnnualDeltaCard label="Receita anual" value={data.totals.income} prev={data.prev_totals.income} currency={currency} />
        <AnnualDeltaCard label="Despesa anual" value={data.totals.expense} prev={data.prev_totals.expense} currency={currency} invert />
        <AnnualDeltaCard label="Saldo anual" value={data.totals.balance} prev={data.prev_totals.balance} currency={currency} />
      </div>
      <div className="card-soft">
        <h3 className="text-lg font-semibold mb-4">{tr("Receita e despesa por mês")}</h3>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E4E0" />
              <XAxis dataKey="name" stroke="#6B7068" fontSize={12} />
              <YAxis stroke="#6B7068" fontSize={12} />
              <Tooltip formatter={value => fmtMoney(value, currency)} />
              <Legend />
              <Bar dataKey="income" name={tr("Receita")} fill="#2C7A51" radius={[6, 6, 0, 0]} />
              <Bar dataKey="expense" name={tr("Despesa")} fill="#D9453B" radius={[6, 6, 0, 0]} />
              <Bar dataKey="prevExpense" name={`Despesa ${data.prev_year}`} fill="#C7BCA1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="card-soft overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-[#F1EFE7] text-[#6B7068]"><tr><th className="text-left py-3 px-4">{tr("Mês")}</th><th className="text-right py-3 px-4">{tr("Receita")}</th><th className="text-right py-3 px-4">{tr("Despesa")}</th><th className="text-right py-3 px-4">{tr("Saldo")}</th></tr></thead>
          <tbody>{data.months.map(month => <tr key={month.month} className="border-b border-[#E5E4E0]"><td className="py-3 px-4 font-medium">{MONTHS[month.month - 1]}</td><td className="py-3 px-4 text-right text-emerald-600">{fmtMoney(month.income, currency)}</td><td className="py-3 px-4 text-right text-rose-600">{fmtMoney(month.expense, currency)}</td><td className={`py-3 px-4 text-right font-semibold ${month.balance >= 0 ? "text-[#061B4A]" : "text-rose-600"}`}>{fmtMoney(month.balance, currency)}</td></tr>)}</tbody>
          <tfoot><tr className="bg-[#F1EFE7] font-semibold"><td className="py-3 px-4">{tr("Total")}</td><td className="py-3 px-4 text-right text-emerald-600">{fmtMoney(data.totals.income, currency)}</td><td className="py-3 px-4 text-right text-rose-600">{fmtMoney(data.totals.expense, currency)}</td><td className="py-3 px-4 text-right text-[#061B4A]">{fmtMoney(data.totals.balance, currency)}</td></tr></tfoot>
        </table>
      </div>
    </>
  );
}
