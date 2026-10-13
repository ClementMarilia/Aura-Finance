import { useState } from "react";
import { Link } from "react-router-dom";
import { Target } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart, PolarAngleAxis,
  PolarGrid, Radar, RadarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtMoney } from "@/lib/api";
import { getLocale, translate as tr } from "@/i18n";
import { useTheme } from "@/context/ThemeContext";
import { SectionTitle } from "@/components/dashboard/DashboardBlocks";

const heading = { fontFamily: "Outfit" };
const ACCENT = "#08B6E7";
const ACCENT_2 = "#08D7A5";

// Series colours for donuts and legends, tuned for each theme's card surface.
export function useChartPalette() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark"
    ? ["#08D7A5", "#08B6E7", "#4C8DF6", "#2C5591", "#7C8DB5", "#A6B2CC"]
    : ["#0B2350", "#1268F4", "#08B6E7", "#08D7A5", "#7C8DB5", "#C7CEDD"];
}

export function compactMoney(value, currency) {
  const amount = Number(value) || 0;
  if (Math.abs(amount) < 1000) return fmtMoney(amount, currency);
  try {
    return new Intl.NumberFormat(getLocale(), {
      style: "currency", currency, notation: "compact", maximumFractionDigits: 1,
    }).format(amount);
  } catch (_) {
    return fmtMoney(amount, currency);
  }
}

const compactNumber = (value) => new Intl.NumberFormat(getLocale(), {
  notation: "compact", maximumFractionDigits: 1,
}).format(Number(value) || 0);

const shortLabel = (label) => String(label || "").replace(".", "");

function isFutureMonth(year, month) {
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1);
}

export function MonthStrip({ labels, selected, onSelect, tone = "light", testId }) {
  return (
    <div className="mt-2 grid grid-cols-12 gap-1" data-testid={testId}>
      {labels.map((label, index) => {
        const active = index + 1 === selected;
        return (
          <button key={label} type="button" onClick={() => onSelect(index + 1)}
            aria-pressed={active} aria-label={label}
            className={`min-w-0 rounded-md py-1 text-[9.5px] font-bold uppercase transition-colors duration-200 ${
              active
                ? "bg-[#08B6E7] text-[#032235]"
                : tone === "dark"
                  ? "bg-white/10 text-white/70 hover:bg-white/20"
                  : "bg-[#F1EFE7] text-[#6B7068] hover:text-[#1A1C1A]"
            }`}>
            {shortLabel(label).slice(0, 3)}
          </button>
        );
      })}
    </div>
  );
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label}
      className="inline-flex overflow-hidden rounded-lg border border-[#E5E4E0]">
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`px-2.5 py-1 text-[11px] transition-colors duration-200 ${
            value === option.value
              ? "bg-[#1268F4] font-semibold text-white"
              : "text-[#6B7068] hover:text-[#1A1C1A]"
          }`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

const tooltipStyle = {
  contentStyle: {
    background: "#0A1A3F", border: "none", borderRadius: 10, color: "#fff", fontSize: 12,
  },
  itemStyle: { color: "#fff" },
  labelStyle: { color: "#A6B2CC" },
};

// Twelve months of the selected year; clicking a bar or a month moves the
// whole dashboard to that month.
export function FlowCard({ months, year, selectedMonth, onSelectMonth, monthLabels, currency }) {
  const [mode, setMode] = useState("income");
  const rows = (months || []).map((item) => ({
    ...item,
    label: shortLabel(monthLabels[item.month - 1]),
    value: item[mode] || 0,
    future: isFutureMonth(year, item.month),
  }));
  const selected = rows[selectedMonth - 1];

  const fillFor = (row) => {
    const distance = Math.abs(row.month - selectedMonth);
    if (distance === 0) return "url(#flowSelected)";
    if (distance === 1) return ACCENT;
    if (row.value < 0) return "var(--danger, #D9453B)";
    return "var(--chart-bar)";
  };

  const renderLabel = ({ x, y, width, value, index }) => {
    if (index !== selectedMonth - 1) return null;
    return (
      <text x={x + width / 2} y={value < 0 ? y + 14 : y - 6} textAnchor="middle"
        fontSize={11} fontWeight={700} fill="var(--text-main, #061B4A)">
        {compactMoney(value, currency)}
      </text>
    );
  };

  return (
    <section className="card-soft h-full p-4 md:p-5" data-testid="dashboard-cashflow">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-[#1A1C1A]" style={heading}>{tr("Fluxo de caixa")}</h3>
        <Segmented label={tr("Série do gráfico")} value={mode} onChange={setMode} options={[
          { value: "expense", label: tr("Saídas") },
          { value: "balance", label: tr("Resultado") },
          { value: "income", label: tr("Entradas") },
        ]} />
        <span className="money-value text-lg font-semibold text-[#1A1C1A]" style={heading} data-testid="flow-selected-value">
          {selected ? fmtMoney(selected.value, currency) : "—"}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="flex h-[190px] items-center justify-center text-sm text-[#6B7068]">{tr("Carregando...")}</div>
      ) : (
        <div style={{ width: "100%", height: 190 }}>
          <ResponsiveContainer>
            <BarChart data={rows} barCategoryGap="30%" margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="flowSelected" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT_2} />
                  <stop offset="100%" stopColor={ACCENT} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border, #E5E4E0)" />
              <XAxis dataKey="label" hide />
              <YAxis width={36} tickLine={false} axisLine={false} fontSize={10}
                stroke="var(--text-muted, #6B7068)" tickFormatter={compactNumber} />
              <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface-muted, #F1EFE7)" }}
                formatter={(value) => [fmtMoney(value, currency), tr({ income: "Entradas", expense: "Saídas", balance: "Resultado" }[mode])]} />
              <Bar dataKey="value" radius={[6, 6, 6, 6]} isAnimationActive={false}
                onClick={(_, index) => onSelectMonth(index + 1)} style={{ cursor: "pointer" }}>
                {rows.map((row) => (
                  <Cell key={row.month} fill={fillFor(row)}
                    fillOpacity={row.future ? 0.35 : Math.abs(row.month - selectedMonth) === 1 ? 0.55 : 1} />
                ))}
                <LabelList dataKey="value" content={renderLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <MonthStrip labels={monthLabels} selected={selectedMonth} onSelect={onSelectMonth} testId="flow-months" />
    </section>
  );
}

export function GoalsCard({ summary, currency }) {
  return (
    <section className="card-soft h-full p-4 md:p-5" data-testid="dashboard-goals">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="flex min-w-0 items-baseline gap-2 text-base font-semibold text-[#1A1C1A]" style={heading}>
          {tr("Metas")}
          {summary.target > 0 && (
            <span className="money-value truncate text-xs font-semibold text-[#1268F4]">
              {fmtMoney(summary.saved, currency)} / {fmtMoney(summary.target, currency)}
            </span>
          )}
        </h3>
        {summary.target > 0 && (
          <span className="text-base font-bold text-[#1A1C1A]" style={heading}>{summary.percent}%</span>
        )}
      </div>
      {summary.rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-[#6B7068]">
          {tr("Nenhuma meta criada ainda.")}{" "}
          <Link to="/metas" className="font-medium text-[#1268F4] hover:underline">{tr("Criar meta")}</Link>
        </div>
      ) : (
        <>
          <div className="dash-track h-2 overflow-hidden rounded-full" role="progressbar"
            aria-valuenow={summary.percent} aria-valuemin={0} aria-valuemax={100} aria-label={tr("Metas")}>
            <div className="dash-fill h-full rounded-full" style={{ width: `${Math.min(summary.percent, 100)}%` }} />
          </div>
          <ul className="mt-1 divide-y divide-[#E5E4E0]">
            {summary.rows.map((goal) => {
              const own = goal.currency || currency;
              return (
                <li key={goal.id}>
                  <Link to="/metas" className="grid grid-cols-[28px_1fr_auto] items-center gap-3 py-2.5 text-xs">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F1EFE7] text-[#1268F4]">
                      <Target size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[#1A1C1A]">{goal.title}</span>
                      <span className="money-value block text-[11px] text-[#6B7068]">
                        {fmtMoney(goal.current_amount, own)} / {fmtMoney(goal.target_amount, own)}
                      </span>
                      <span className="dash-track mt-1 block h-1 overflow-hidden rounded-full">
                        <span className="dash-fill block h-full rounded-full" style={{ width: `${Math.min(goal.percent, 100)}%` }} />
                      </span>
                    </span>
                    <span className={`text-xs font-bold ${goal.percent >= 100 ? "text-emerald-600" : "text-[#1A1C1A]"}`}>
                      {goal.percent}%
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {summary.hidden > 0 && (
            <Link to="/metas" className="mt-1 inline-flex text-xs font-medium text-[#1268F4] hover:underline">
              {tr("Ver mais ({count})", { count: summary.hidden })}
            </Link>
          )}
        </>
      )}
    </section>
  );
}

export function BudgetCard({ data, currency }) {
  const palette = useChartPalette();
  const rules = data.budget?.rules || [];
  const income = Number(data.income) || 0;
  const expense = Number(data.expense) || 0;
  const flowTotal = income + expense;
  const incomeShare = flowTotal > 0 ? Math.round((income / flowTotal) * 100) : 0;
  const hasBase = (data.budget?.income || 0) > 0;
  return (
    <section className="card-soft h-full p-4 md:p-5" data-testid="dashboard-budget">
      <SectionTitle action={<span className="text-xs text-[#6B7068]">{tr("Base:")} {fmtMoney(data.budget?.income || 0, currency)}</span>}>
        {tr("Orçamento 50/20/10/10/10")}
      </SectionTitle>
      <div className="grid grid-cols-1 items-center gap-5 sm:grid-cols-[150px_1fr]">
        <div className="relative mx-auto h-[150px] w-[150px]">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={hasBase ? rules : [{ label: "", amount: 1 }]} dataKey="amount" nameKey="label"
                innerRadius={52} outerRadius={72} paddingAngle={hasBase ? 2 : 0} stroke="none" isAnimationActive={false}>
                {(hasBase ? rules : [0]).map((rule, index) => (
                  <Cell key={rule.label || index} fill={hasBase ? palette[index % palette.length] : "var(--surface-muted, #F1EFE7)"} />
                ))}
              </Pie>
              {hasBase && <Tooltip {...tooltipStyle} formatter={(value, name) => [fmtMoney(value, currency), tr(name)]} />}
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="money-value text-lg font-bold text-[#1A1C1A]" style={heading}>{compactMoney(data.budget?.income || 0, currency)}</span>
            <span className="text-[10px] text-[#6B7068]">{tr("planejado")}</span>
          </div>
        </div>
        <div className="min-w-0">
          {[
            { label: tr("Entradas"), share: incomeShare, className: "dash-fill" },
            { label: tr("Saídas"), share: flowTotal > 0 ? 100 - incomeShare : 0, className: "bg-[#7C8DB5]" },
          ].map((row) => (
            <div key={row.label} className="mb-2 grid grid-cols-[64px_1fr_36px] items-center gap-2 text-xs">
              <span className="text-[#6B7068]">{row.label}</span>
              <span className="dash-track h-2 overflow-hidden rounded-full">
                <span className={`block h-full rounded-full ${row.className}`} style={{ width: `${row.share}%` }} />
              </span>
              <span className="text-right font-semibold text-[#1A1C1A]">{row.share}%</span>
            </div>
          ))}
          <div className="mt-3">
            <ul className="min-w-0 space-y-1.5 text-xs">
              {rules.map((rule, index) => (
                <li key={rule.label} className="flex items-center gap-2">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
                  <span className="min-w-0 flex-1 truncate text-[#1A1C1A]">{tr(rule.label)}</span>
                  <span className="w-9 text-right text-[#6B7068]">{rule.percent}%</span>
                  <span className="whitespace-nowrap text-right font-semibold tabular-nums text-[#1A1C1A]">{fmtMoney(rule.amount, currency)}</span>
                </li>
              ))}
            </ul>
            <Link to="/extrato-financeiro" data-testid="budget-result"
              className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[#E5E4E0] bg-[#F8F7F3] px-3 py-2">
              <span className="text-xs text-[#6B7068]">{tr("Resultado do mês")}</span>
              <span className={`money-value text-base font-bold ${data.balance < 0 ? "text-rose-600" : "text-[#1A1C1A]"}`} style={heading}>
                {fmtMoney(data.balance, currency)}
              </span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const ACCOUNT_TYPE_LABELS = {
  checking: "Conta corrente",
  savings: "Poupança",
  investment: "Investimento",
  card: "Cartão",
  cash: "Dinheiro",
  other: "Outro",
};

// Where the money sits, by wallet type. The shape uses the square root of
// each balance so a small wallet is still visible next to a large one; the
// tooltip shows the real amount.
export function StructureCard({ rows, currency }) {
  const withMoney = rows.filter((row) => row.value > 0);
  const chart = rows.map((row) => ({
    ...row, label: tr(ACCOUNT_TYPE_LABELS[row.type] || "Outro"), shape: Math.sqrt(row.value),
  }));
  return (
    <section className="card-soft h-full p-4 md:p-5" data-testid="dashboard-structure">
      <SectionTitle action={<span className="text-[11px] text-[#6B7068]">{tr("saldo por tipo de conta")}</span>}>
        {tr("Estrutura")}
      </SectionTitle>
      {withMoney.length === 0 ? (
        <div className="py-10 text-center text-sm text-[#6B7068]">{tr("Nenhuma conta com saldo")}</div>
      ) : (
        <div style={{ width: "100%", height: 210 }}>
          <ResponsiveContainer>
            <RadarChart data={chart} outerRadius="58%">
              <PolarGrid stroke="var(--border, #E5E4E0)" />
              <PolarAngleAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-muted, #6B7068)" }} />
              <Radar dataKey="shape" stroke={ACCENT} strokeWidth={2} fill={ACCENT} fillOpacity={0.22}
                dot={{ r: 3.5, fill: ACCENT_2, strokeWidth: 0 }} isAnimationActive={false} />
              <Tooltip {...tooltipStyle}
                formatter={(_, __, item) => [fmtMoney(item?.payload?.value || 0, currency), item?.payload?.label]} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

// This year's spending against last year's, month by month. Months that have
// not happened yet are left out instead of drawn as zero.
export function CompareCard({ report, selectedMonth, monthLabels, currency }) {
  const [show, setShow] = useState({ previous: true, income: true });
  const year = report?.year;
  const rows = (report?.months || []).map((item, index) => {
    const future = isFutureMonth(year, item.month);
    return {
      label: shortLabel(monthLabels[item.month - 1]),
      expense: future ? null : item.expense,
      income: future ? null : item.income,
      previous: report.prev_months?.[index]?.expense ?? null,
    };
  });
  const current = report?.months?.[selectedMonth - 1];
  const toggles = [
    { key: "previous", label: tr("Saídas {year}", { year: report?.prev_year ?? "" }), color: ACCENT_2 },
    { key: "income", label: tr("Entradas"), color: "#A6B2CC" },
  ];
  return (
    <section className="dash-dark-card h-full rounded-2xl p-4 md:p-5" data-testid="dashboard-compare">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-baseline gap-2 text-base font-semibold text-white" style={heading}>
          {tr("Comparativo")}
          {current && (
            <span className="money-value text-xs font-semibold text-[#7FE3F7]">
              {tr("Saídas")} {fmtMoney(current.expense, currency)}
            </span>
          )}
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          {toggles.map((toggle) => (
            <button key={toggle.key} type="button" aria-pressed={show[toggle.key]}
              onClick={() => setShow((value) => ({ ...value, [toggle.key]: !value[toggle.key] }))}
              className="inline-flex items-center gap-1.5 text-[11px] text-white/80 hover:text-white">
              <span className={`relative block h-3.5 w-6 flex-shrink-0 rounded-full transition-colors duration-200 ${show[toggle.key] ? "" : "bg-white/25"}`}
                style={show[toggle.key] ? { backgroundColor: toggle.color } : undefined}>
                <span className={`absolute left-0.5 top-0.5 block h-2.5 w-2.5 rounded-full bg-white transition-transform duration-200 ${
                  show[toggle.key] ? "translate-x-2.5" : "translate-x-0"}`} />
              </span>
              {toggle.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="flex h-[170px] items-center justify-center text-sm text-white/70">{tr("Carregando...")}</div>
      ) : (
        <div style={{ width: "100%", height: 170 }}>
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10}
                stroke="rgba(255,255,255,0.55)" interval={0} tickFormatter={(value) => value.slice(0, 3)} />
              <YAxis hide domain={[0, "auto"]} />
              <ReferenceLine x={rows[selectedMonth - 1]?.label} stroke="rgba(255,255,255,0.35)" />
              <Tooltip {...tooltipStyle} formatter={(value, name) => [fmtMoney(value, currency), name]} />
              {show.income && (
                <Line type="monotone" dataKey="income" name={tr("Entradas")} stroke="#A6B2CC" strokeWidth={2}
                  dot={false} isAnimationActive={false} />
              )}
              {show.previous && (
                <Line type="monotone" dataKey="previous" name={tr("Saídas {year}", { year: report.prev_year })}
                  stroke={ACCENT_2} strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
              )}
              <Line type="monotone" dataKey="expense" name={tr("Saídas {year}", { year })} stroke={ACCENT}
                strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

export function AnnualCard({ rows, selectedYear, currency }) {
  const renderLabel = ({ x, y, width, value, index }) => {
    if (rows[index]?.year !== selectedYear) return null;
    return (
      <text x={x + width / 2} y={value < 0 ? y + 14 : y - 6} textAnchor="middle" fontSize={11}
        fontWeight={700} fill="var(--text-main, #061B4A)">
        {compactMoney(value, currency)}
      </text>
    );
  };
  return (
    <section className="card-soft h-full p-4 md:p-5" data-testid="dashboard-annual">
      <SectionTitle action={<span className="text-[11px] text-[#6B7068]">{tr("resultado do ano")}</span>}>
        {tr("Visão anual")}
      </SectionTitle>
      {rows.length === 0 ? (
        <div className="flex h-[170px] items-center justify-center text-sm text-[#6B7068]">{tr("Carregando...")}</div>
      ) : (
        <>
          <div style={{ width: "100%", height: 160 }}>
            <ResponsiveContainer>
              <BarChart data={rows.map((row) => ({ ...row, label: `${row.year}${row.projected ? "*" : ""}` }))}
                barCategoryGap="35%" margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="annualSelected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4C8DF6" />
                    <stop offset="100%" stopColor="#1268F4" />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="var(--text-muted, #6B7068)" />
                <YAxis hide />
                <ReferenceLine y={0} stroke="var(--border, #E5E4E0)" />
                <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface-muted, #F1EFE7)" }}
                  formatter={(value) => [fmtMoney(value, currency), tr("Resultado")]} />
                <Bar dataKey="balance" radius={[6, 6, 6, 6]} isAnimationActive={false}>
                  {rows.map((row) => (
                    <Cell key={row.year}
                      fill={row.projected ? ACCENT_2 : row.year === selectedYear ? "url(#annualSelected)" : "var(--chart-bar)"}
                      fillOpacity={row.projected ? 0.3 : row.year === selectedYear ? 1 : 0.6}
                      stroke={row.projected ? ACCENT_2 : "none"} strokeDasharray={row.projected ? "4 4" : undefined} />
                  ))}
                  <LabelList dataKey="balance" content={renderLabel} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {rows.some((row) => row.projected) && (
            <div className="mt-1 text-[11px] text-[#6B7068]">{tr("* projeção pela média mensal recente")}</div>
          )}
        </>
      )}
    </section>
  );
}
