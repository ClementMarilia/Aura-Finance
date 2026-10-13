import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, CreditCard, HandCoins,
  PiggyBank, Receipt, Repeat,
} from "lucide-react";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, YAxis } from "recharts";
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
export function ForecastHero({
  forecast, currency, payableTo, receivableTo, monthName, patrimony, delta, trend,
}) {
  const negative = forecast.leftover < 0;
  const percent = Math.round(forecast.committedRatio * 100);
  const circumference = 2 * Math.PI * 24;
  const trendRows = (trend || []).map((value, index) => ({ index, value }));
  return (
    <section className="dash-dark-card flex h-full flex-col rounded-2xl p-4 md:p-5" data-testid="dashboard-forecast">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/70">
            {negative
              ? tr("Vai faltar em {month}", { month: monthName })
              : tr("Vai sobrar em {month}", { month: monthName })}
          </div>
          <div className="dashboard-stat-value mt-1 font-semibold leading-tight tabular-nums"
            style={heading} data-testid="dashboard-balance">
            {fmtMoney(Math.abs(forecast.leftover), currency)}
          </div>
        </div>
        <div className="relative h-[58px] w-[58px] flex-shrink-0" role="progressbar"
          aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
          aria-label={tr("{percent}% do que entra já está comprometido", { percent })}>
          <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true">
            <circle cx="29" cy="29" r="24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5" />
            <circle cx="29" cy="29" r="24" fill="none" strokeWidth="5" strokeLinecap="round"
              stroke={percent >= 90 ? "#FF9C93" : "#08D7A5"} transform="rotate(-90 29 29)"
              strokeDasharray={`${(circumference * percent) / 100} ${circumference}`} />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">{percent}%</span>
        </div>
      </div>
      <div className="mt-0.5 text-[11px] text-white/70">{tr("comprometido do que entra")}</div>

      {trendRows.length > 1 && (
        <div className="mt-3 h-16" aria-hidden="true">
          <ResponsiveContainer>
            <AreaChart data={trendRows} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
              <defs>
                <linearGradient id="heroTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#08D7A5" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#08D7A5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Area type="monotone" dataKey="value" stroke="#7FE3F7" strokeWidth={2} fill="url(#heroTrend)"
                isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-2 flex items-end justify-between gap-3">
        {patrimony !== null && patrimony !== undefined ? (
          <Link to="/carteiras" className="min-w-0" data-testid="forecast-patrimony">
            <div className="text-[11px] text-white/70">{tr("Patrimônio")}</div>
            <div className="money-value text-lg font-semibold" style={heading}>{fmtMoney(patrimony, currency)}</div>
          </Link>
        ) : <span />}
        {delta !== null && delta !== undefined && (
          <div className="text-right">
            <div className="text-[11px] text-white/70">{tr("vs. mês anterior")}</div>
            <div className={`inline-flex items-center gap-0.5 text-xs font-bold ${delta >= 0 ? "text-[#7FE3F7]" : "text-[#FF9C93]"}`}>
              {delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
        <Link to={receivableTo} data-testid="forecast-receivable"
          className="rounded-xl bg-white/10 px-3 py-2 transition-colors duration-200 hover:bg-white/20">
          <div className="flex items-center gap-1.5 text-[11px] text-white/70"><HandCoins size={13} /> {tr("A receber")}</div>
          <div className="money-value mt-0.5 text-base font-semibold" style={heading}>{fmtMoney(forecast.receivable, currency)}</div>
        </Link>
        <Link to={payableTo} data-testid="forecast-payable"
          className="rounded-xl bg-white/10 px-3 py-2 transition-colors duration-200 hover:bg-white/20">
          <div className="flex items-center gap-1.5 text-[11px] text-white/70"><Receipt size={13} /> {tr("A pagar")}</div>
          <div className="money-value mt-0.5 text-base font-semibold" style={heading}>{fmtMoney(forecast.payable, currency)}</div>
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
    <section className="card-soft h-full p-4 md:p-5" data-testid="dashboard-commitments">
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
    <section className="card-soft h-full p-4 md:p-5" data-testid="account-balances">
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

export function CategoryCard({ breakdown, currency, to }) {
  const themed = useThemedColor();
  return (
    <section className="card-soft h-full p-4 md:p-5" data-testid="dashboard-categories">
      <SectionTitle>{tr("Gastos por categoria")}</SectionTitle>
      {breakdown.items.length === 0 ? (
        <div className="py-10 text-center text-sm text-[#6B7068]">{tr("Sem despesas neste período")}</div>
      ) : (
        <>
          <div className="relative mx-auto h-44 w-44">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={breakdown.items} dataKey="amount" nameKey="category"
                  innerRadius={56} outerRadius={84} paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {breakdown.items.map((item) => <Cell key={item.category} fill={themed(item.color)} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="money-value text-lg font-bold text-[#1A1C1A]" style={heading}>{fmtMoney(breakdown.total, currency)}</span>
              <span className="text-[10px] uppercase tracking-wide text-[#6B7068]">{tr("Total")}</span>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {breakdown.items.map((item) => (
              <li key={item.category}>
                <Link to={to} className="flex items-center gap-2 text-sm">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: themed(item.color) }} />
                  <span className="min-w-0 flex-1 truncate text-[#1A1C1A]">{tr(item.category)}</span>
                  <span className="w-10 text-right text-xs text-[#6B7068]">{item.percent}%</span>
                  <span className="whitespace-nowrap text-right font-semibold tabular-nums text-[#1A1C1A]">{fmtMoney(item.amount, currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
