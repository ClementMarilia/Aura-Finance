import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, CalendarRange, TrendingUp } from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import api from "@/lib/api";
import { translate as tr } from "@/i18n";

const ranges = [
  ["today", "Hoje"],
  ["7d", "7 dias"],
  ["30d", "30 dias"],
  ["90d", "90 dias"],
  ["12m", "12 meses"],
];

const sourceLabels = {
  transaction: "Lançamento",
  installment: "Parcela",
  receivable: "Conta a receber",
  recurrence: "Recorrência",
};

function money(value, currency) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "EUR",
  }).format(Number(value) || 0);
}

function compactDate(value) {
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" })
    .format(new Date(`${value}T12:00:00`));
}

export default function ProjectedCashFlow() {
  const [range, setRange] = useState("30d");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["projected-cash-flow", range],
    queryFn: async () => (await api.get("/projections", { params: { range } })).data,
    staleTime: 60_000,
  });

  const chartData = useMemo(() => {
    const days = data?.days || [];
    if (days.length <= 100) return days;
    const step = Math.ceil(days.length / 90);
    return days.filter((_, index) => index % step === 0 || index === days.length - 1);
  }, [data?.days]);
  const activeDays = (data?.days || []).filter((day) => day.events?.length);

  if (isLoading) return <div className="p-8 text-[#6B7068]">{tr("Carregando...")}</div>;
  if (isError) return (
    <div className="rounded-2xl border p-6" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <p className="font-medium">{tr("Não foi possível carregar a projeção financeira.")}</p>
      <p className="mt-1 text-sm text-[#6B7068]">{tr("Atualize a página e tente novamente.")}</p>
    </div>
  );

  const currency = data?.currency || "EUR";
  const difference = Number(data?.projected_balance || 0) - Number(data?.current_balance || 0);

  return (
    <div className="space-y-6" data-testid="projected-cash-flow-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-[#6B7068]">
            <CalendarRange size={17} /> {tr("Planejamento financeiro")}
          </div>
          <h1 className="text-2xl font-semibold text-[#1A1C1A]" style={{ fontFamily: "Outfit" }}>
            {tr("Fluxo de caixa projetado")}
          </h1>
          <p className="mt-1 text-sm text-[#6B7068]">
            {tr("Previsão baseada no saldo atual e nos compromissos financeiros cadastrados.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={tr("Período da projeção")}>
          {ranges.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              aria-pressed={range === key}
              className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                range === key ? "bg-[#061B4A] text-white" : "text-[#6B7068] hover:bg-[#F1EFE7]"
              }`}
              style={{ borderColor: range === key ? "#061B4A" : "var(--border)" }}
            >
              {tr(label)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={tr("Saldo atual")} value={money(data?.current_balance, currency)} />
        <Metric label={tr("Saldo previsto")} value={money(data?.projected_balance, currency)}
          detail={`${difference >= 0 ? "+" : ""}${money(difference, currency)}`} />
        <Metric label={tr("Entradas previstas")} value={money(data?.income, currency)} icon={ArrowUpRight} />
        <Metric label={tr("Saídas previstas")} value={money(data?.expenses, currency)} icon={ArrowDownRight} />
      </div>

      <section className="rounded-2xl border p-4 md:p-6" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mb-5 flex items-center gap-2">
          <TrendingUp size={18} className="text-[#061B4A]" />
          <h2 className="font-medium text-[#1A1C1A]">{tr("Evolução do saldo previsto")}</h2>
        </div>
        <div className="h-72 w-full" aria-label={tr("Gráfico do saldo projetado")}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={compactDate} minTickGap={28} fontSize={12} />
              <YAxis width={72} tickFormatter={(value) => new Intl.NumberFormat(undefined, { notation: "compact" }).format(value)} fontSize={12} />
              <Tooltip labelFormatter={compactDate} formatter={(value) => [money(value, currency), tr("Saldo")]} />
              <Line type="monotone" dataKey="balance" stroke="var(--primary, #061B4A)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="border-b px-4 py-4 md:px-6" style={{ borderColor: "var(--border)" }}>
          <h2 className="font-medium text-[#1A1C1A]">{tr("Movimentações previstas")}</h2>
          <p className="mt-1 text-sm text-[#6B7068]">{tr("Somente dias com entradas ou saídas são exibidos.")}</p>
        </div>
        {activeDays.length === 0 ? (
          <p className="p-6 text-sm text-[#6B7068]">{tr("Nenhuma movimentação prevista para este período.")}</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {activeDays.map((day) => (
              <div key={day.date} className="grid gap-3 p-4 md:grid-cols-[110px_1fr_auto] md:px-6">
                <div>
                  <p className="font-medium text-[#1A1C1A]">{compactDate(day.date)}</p>
                  <p className="text-xs text-[#6B7068]">{money(day.balance, currency)}</p>
                </div>
                <div className="space-y-2">
                  {day.events.map((event) => (
                    <div key={event.id} className="flex min-w-0 items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate text-[#1A1C1A]">{event.description || tr(sourceLabels[event.source] || "Movimentação")}</p>
                        <p className="text-xs text-[#6B7068]">{tr(sourceLabels[event.source] || "Movimentação")}</p>
                      </div>
                      <span className={event.type === "income" ? "text-emerald-700" : "text-rose-600"}>
                        {event.type === "income" ? "+" : "-"}{money(event.amount, currency)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 text-sm md:block md:text-right">
                  {day.income > 0 && <p className="text-emerald-700">+{money(day.income, currency)}</p>}
                  {day.expense > 0 && <p className="text-rose-600">-{money(day.expense, currency)}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, detail, icon: Icon }) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-center justify-between gap-2 text-sm text-[#6B7068]">
        <span>{label}</span>{Icon && <Icon size={17} />}
      </div>
      <p className="mt-2 text-xl font-semibold text-[#1A1C1A]">{value}</p>
      {detail && <p className="mt-1 text-xs text-[#6B7068]">{detail}</p>}
    </div>
  );
}
