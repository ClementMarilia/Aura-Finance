import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, CreditCard, HandCoins,
  PiggyBank, Receipt, Repeat,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtMoney } from "@/lib/api";
import { translate as tr } from "@/i18n";
import { useThemedColor } from "@/lib/colors";

const heading = { fontFamily: "Outfit" };

export function SectionTitle({ children, action }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-base font-semibold text-[#1A1C1A]" style={heading}>{children}</h3>
      {action}
    </div>
  );
}

// The first thing on the screen: will the month close positive, and how much
// is still coming in or going out.
export function ForecastHero({ forecast, currency, payableTo, receivableTo }) {
  const negative = forecast.leftover < 0;
  const percent = Math.round(forecast.committedRatio * 100);
  return (
    <section
      className="card-soft bg-gradient-to-br from-[#061B4A] to-[#1268F4] text-white border-transparent"
      data-testid="dashboard-forecast"
    >
      <div className="text-xs font-medium uppercase tracking-[0.08em] opacity-80">
        {negative ? tr("Vai faltar este mês") : tr("Vai sobrar este mês")}
      </div>
      <div className="money-value mt-1 text-[clamp(2.25rem,9vw,3.25rem)] font-semibold leading-tight tracking-tight"
        style={heading} data-testid="dashboard-balance">
        {fmtMoney(Math.abs(forecast.leftover), currency)}
      </div>

      <div className="mt-4">
        <div className="h-2 overflow-hidden rounded-full bg-white/20" role="progressbar"
          aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${percent >= 90 ? "bg-rose-300" : "bg-white"}`}
            style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-1.5 text-xs opacity-80">
          {tr("{percent}% do que entra já está comprometido", { percent })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link to={receivableTo} data-testid="forecast-receivable"
          className="rounded-xl bg-white/10 px-3 py-2.5 transition hover:bg-white/20">
          <div className="flex items-center gap-1.5 text-xs opacity-80"><HandCoins size={14} /> {tr("A receber")}</div>
          <div className="money-value mt-0.5 text-lg font-semibold" style={heading}>{fmtMoney(forecast.receivable, currency)}</div>
        </Link>
        <Link to={payableTo} data-testid="forecast-payable"
          className="rounded-xl bg-white/10 px-3 py-2.5 transition hover:bg-white/20">
          <div className="flex items-center gap-1.5 text-xs opacity-80"><Receipt size={14} /> {tr("A pagar")}</div>
          <div className="money-value mt-0.5 text-lg font-semibold" style={heading}>{fmtMoney(forecast.payable, currency)}</div>
        </Link>
      </div>
    </section>
  );
}

function DeltaBadge({ value, goodWhenUp }) {
  if (value === null || value === undefined) return null;
  const up = value >= 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
      good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
    }`}>
      <Icon size={12} /> {Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
    </span>
  );
}

export function KpiTile({ label, value, currency, to, tone, delta, goodWhenUp = true, hint, testId }) {
  return (
    <Link to={to} data-testid={testId}
      className="card-soft block min-w-0 p-4 transition hover:shadow-md">
      <div className="stat-label">{label}</div>
      <div className={`money-value mt-1 truncate text-xl font-semibold sm:text-2xl ${tone}`} style={heading}>
        {fmtMoney(value, currency)}
      </div>
      {delta !== undefined && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#6B7068]">
          <DeltaBadge value={delta} goodWhenUp={goodWhenUp} />
          {delta !== null && <span>{tr("vs. mês anterior")}</span>}
        </div>
      )}
      {hint && <div className="mt-1.5 text-xs text-[#6B7068]">{hint}</div>}
    </Link>
  );
}

export function CommitmentsCard({ rows, currency }) {
  const visible = rows.filter((row) => row.value > 0);
  if (visible.length === 0) return null;
  const icons = { future_installments: CreditCard, fixed_monthly: Repeat };
  return (
    <section className="card-soft p-4" data-testid="dashboard-commitments">
      <SectionTitle>{tr("Compromissos")}</SectionTitle>
      <div className="divide-y divide-[#E5E4E0]">
        {visible.map((row) => {
          const Icon = icons[row.id] || Receipt;
          return (
            <Link key={row.id} to={row.to} data-testid={row.testId}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#F1EFE7] text-[#061B4A]">
                <Icon size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[#1A1C1A]">{row.label}</span>
                {row.hint && <span className="block truncate text-xs text-[#6B7068]">{row.hint}</span>}
              </span>
              <span className="money-value text-sm font-semibold text-[#1A1C1A]">{fmtMoney(row.value, currency)}</span>
              <ChevronRight size={16} className="text-[#A8ABA0]" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function AccountsCard({ summary, currency }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const rows = showEmpty ? summary.all : summary.active;
  return (
    <section className="card-soft p-4" data-testid="account-balances">
      <SectionTitle action={<Link to="/carteiras" className="text-xs font-medium text-[#1268F4]">{tr("Ver todas")}</Link>}>
        {tr("Minhas contas")}
      </SectionTitle>
      <Link to="/carteiras" data-testid="patrimonio-card"
        className="mb-3 flex items-center justify-between rounded-xl bg-[#F1EFE7] px-3 py-2.5">
        <span className="flex items-center gap-2 text-sm text-[#6B7068]"><PiggyBank size={16} /> {tr("Patrimônio")}</span>
        <span className={`money-value text-lg font-semibold ${summary.total < 0 ? "text-rose-600" : "text-[#061B4A]"}`}
          style={heading} data-testid="patrimonio-value">
          {fmtMoney(summary.total, currency)}
        </span>
      </Link>
      {rows.length === 0 && (
        <div className="py-2 text-sm text-[#6B7068]">{tr("Nenhuma conta com saldo")}</div>
      )}
      <div className="divide-y divide-[#E5E4E0]">
        {rows.map((account) => {
          const own = account.currency || currency;
          return (
            <Link key={account.id} to={`/lancamentos?account_id=${account.id}`}
              data-testid={`account-card-${account.id}`}
              className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate text-sm text-[#1A1C1A]">{tr(account.name)}</span>
              <span className="text-right">
                <span className={`money-value block text-sm font-semibold ${account.balance < 0 ? "text-rose-600" : "text-[#1A1C1A]"}`}>
                  {fmtMoney(account.balance, own)}
                </span>
                {own !== currency && (
                  <span className="block text-[11px] text-[#6B7068]">≈ {fmtMoney(account.balance_base || 0, currency)}</span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
      {summary.emptyCount > 0 && (
        <button type="button" onClick={() => setShowEmpty((value) => !value)}
          aria-expanded={showEmpty} data-testid="accounts-toggle-empty"
          className="mt-2 inline-flex min-h-[40px] items-center gap-1 text-xs font-medium text-[#6B7068] hover:text-[#1A1C1A]">
          {showEmpty
            ? tr("Ocultar contas zeradas")
            : tr("Mostrar {count} contas zeradas", { count: summary.emptyCount })}
          <ChevronDown size={14} className={showEmpty ? "rotate-180" : ""} />
        </button>
      )}
    </section>
  );
}

export function CashflowCard({ evolution, monthLabels, currency }) {
  const rows = (evolution || []).map((item) => ({
    ...item,
    label: monthLabels[Number(item.month.slice(5, 7)) - 1] || item.month,
    expenseNeg: -(item.expense || 0),
  }));
  return (
    <section className="card-soft p-4" data-testid="dashboard-cashflow">
      <SectionTitle action={
        <div className="flex items-center gap-3 text-[11px] text-[#6B7068]">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "var(--success, #16A34A)" }} />{tr("Receita")}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "var(--danger, #D9453B)" }} />{tr("Despesa")}</span>
        </div>
      }>
        {tr("Fluxo de caixa")}
      </SectionTitle>
      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer>
          <BarChart data={rows} stackOffset="sign" barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border, #E5E4E0)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--text-muted, #6B7068)" />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: "var(--surface-muted, #F1EFE7)" }}
              formatter={(value, name) => [fmtMoney(Math.abs(value), currency), name]}
            />
            <Bar dataKey="income" name={tr("Receita")} stackId="flow" fill="var(--success, #16A34A)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="expenseNeg" name={tr("Despesa")} stackId="flow" fill="var(--danger, #D9453B)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function CategoryCard({ breakdown, currency, to }) {
  const themed = useThemedColor();
  return (
    <section className="card-soft p-4" data-testid="dashboard-categories">
      <SectionTitle>{tr("Gastos por categoria")}</SectionTitle>
      {breakdown.items.length === 0 ? (
        <div className="py-10 text-center text-sm text-[#6B7068]">{tr("Sem despesas neste período")}</div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center lg:flex-col lg:items-stretch">
          <div className="relative mx-auto h-36 w-36 flex-shrink-0">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={breakdown.items} dataKey="amount" nameKey="category"
                  innerRadius={50} outerRadius={68} paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {breakdown.items.map((item) => <Cell key={item.category} fill={themed(item.color)} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[10px] uppercase tracking-wide text-[#6B7068]">{tr("Total")}</span>
              <span className="money-value text-sm font-semibold text-[#1A1C1A]">{fmtMoney(breakdown.total, currency)}</span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-2">
            {breakdown.items.map((item) => (
              <li key={item.category}>
                <Link to={to} className="flex items-center gap-2 text-sm">
                  <span className="w-9 flex-shrink-0 rounded-md bg-[#F1EFE7] py-0.5 text-center text-[11px] font-semibold text-[#1A1C1A]">
                    {item.percent}%
                  </span>
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: themed(item.color) }} />
                  <span className="min-w-0 flex-1 truncate text-[#1A1C1A]">{tr(item.category)}</span>
                  <span className="money-value font-medium text-[#1A1C1A]">{fmtMoney(item.amount, currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
