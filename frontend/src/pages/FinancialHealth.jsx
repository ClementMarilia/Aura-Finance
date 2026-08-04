import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, CircleAlert, HeartPulse, Info, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { getLocale, translate as tr } from "@/i18n";

const factorMeta = {
  positive_balance: { title: "Saldo positivo", path: "/carteiras" },
  emergency_reserve: { title: "Reserva de emergência", path: "/metas" },
  goals_progress: { title: "Progresso das metas", path: "/metas" },
  budget_adherence: { title: "Orçamento respeitado", path: "/orcamento" },
  monthly_savings: { title: "Economia mensal", path: "/lancamentos" },
  overdue_bills: { title: "Contas em atraso", path: "/calendario-financeiro" },
  category_overspending: { title: "Excesso em categorias", path: "/lancamentos" },
  projected_balance: { title: "Saldo projetado", path: "/fluxo-de-caixa" },
};

const levelLabels = {
  excellent: "Excelente",
  good: "Boa",
  attention: "Atenção",
  critical: "Crítica",
};

const tone = {
  good: { color: "#16805D", bg: "#E8F5EF", icon: CheckCircle2 },
  warning: { color: "#A05B00", bg: "#FFF3D8", icon: CircleAlert },
  critical: { color: "#B33A3A", bg: "#FDECEC", icon: ShieldAlert },
  unavailable: { color: "#6B7068", bg: "#F1EFE7", icon: Info },
};

function money(value, currency) {
  return new Intl.NumberFormat(getLocale(), {
    style: "currency", currency: currency || "EUR",
  }).format(Number(value) || 0);
}

function factorExplanation(factor, currency) {
  const evidence = factor.evidence || {};
  if (!factor.available) return tr("Ainda não há dados suficientes para avaliar este fator. Foi aplicada uma pontuação neutra.");
  switch (factor.code) {
    case "positive_balance":
      return tr("Seu saldo atual é {amount}.", { amount: money(evidence.current_balance, currency) });
    case "emergency_reserve":
      return tr("Seu saldo cobre {months} meses da sua despesa média de {amount}.", {
        months: Number(evidence.reserve_months || 0).toLocaleString(getLocale(), { maximumFractionDigits: 1 }),
        amount: money(evidence.average_monthly_expense, currency),
      });
    case "goals_progress":
      return tr("Suas {count} metas têm progresso médio de {rate}%, com {completed} concluídas.", {
        count: evidence.goal_count,
        rate: evidence.average_progress,
        completed: evidence.completed_goals,
      });
    case "budget_adherence":
      return tr("Você utilizou {rate}% da receita do mês: {expense} de {income}.", {
        rate: evidence.spending_rate,
        expense: money(evidence.expense, currency),
        income: money(evidence.income, currency),
      });
    case "monthly_savings":
      return tr("A economia do mês é {amount}, equivalente a {rate}% da receita.", {
        amount: money(evidence.savings, currency), rate: evidence.savings_rate,
      });
    case "overdue_bills":
      return evidence.overdue_count
        ? tr("Existem {count} contas atrasadas, somando {amount}.", { count: evidence.overdue_count, amount: money(evidence.overdue_amount, currency) })
        : tr("Nenhuma conta em atraso foi encontrada.");
    case "category_overspending": {
      const names = (evidence.categories || []).map((item) => item.category).join(", ");
      return evidence.category_count
        ? tr("{count} categorias cresceram acima do limite: {categories}.", { count: evidence.category_count, categories: names })
        : tr("Nenhuma categoria ultrapassou o limite comparado ao mês anterior.");
    }
    case "projected_balance":
      return tr("O saldo projetado para os próximos 30 dias é {amount}.", { amount: money(evidence.projected_balance, currency) });
    default:
      return "";
  }
}

export function isFinancialHealthPayload(value) {
  return Boolean(
    value
    && Number.isFinite(Number(value.score))
    && typeof value.level === "string"
    && value.summary
    && typeof value.summary === "object"
    && Array.isArray(value.factors)
  );
}

export default function FinancialHealth() {
  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: ["financial-health"],
    queryFn: async () => (await api.get("/financial-health")).data,
    staleTime: 60_000,
  });

  const hasValidData = isFinancialHealthPayload(data);
  const chartColor = data?.score >= 65 ? "#16805D" : data?.score >= 45 ? "#E5A83B" : "#D96C5B";
  const sortedFactors = useMemo(() => [...(data?.factors || [])].sort((a, b) => {
    const priority = { critical: 0, warning: 1, unavailable: 2, good: 3 };
    return priority[a.status] - priority[b.status];
  }), [data?.factors]);

  if (isPending || (!hasValidData && isFetching)) {
    return <div className="p-8 text-[#6B7068]">{tr("Calculando saúde financeira...")}</div>;
  }
  if (isError || !hasValidData) return (
    <section className="rounded-2xl border p-6" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <h1 className="font-semibold text-[#1A1C1A]">{tr("Não foi possível calcular sua saúde financeira.")}</h1>
      <p className="mt-1 text-sm text-[#6B7068]">{tr("Atualize os dados e tente novamente.")}</p>
      <button type="button" onClick={() => refetch()} className="mt-4 rounded-xl bg-[#061B4A] px-4 py-2 text-sm text-white">{tr("Tentar novamente")}</button>
    </section>
  );

  return (
    <div className="space-y-6" data-testid="financial-health-page">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm text-[#6B7068]"><HeartPulse size={17} /> {tr("Diagnóstico financeiro")}</div>
        <h1 className="text-2xl font-semibold text-[#1A1C1A]" style={{ fontFamily: "Outfit" }}>{tr("Saúde financeira")}</h1>
        <p className="mt-1 text-sm text-[#6B7068]">{tr("Uma nota transparente baseada nos seus dados reais, sem julgamento e sem IA externa.")}</p>
      </header>

      <section className="grid gap-5 rounded-2xl border p-5 md:grid-cols-[220px_1fr] md:p-7" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex justify-center">
          <div role="img" className="relative grid h-44 w-44 place-items-center rounded-full" style={{ background: `conic-gradient(${chartColor} ${data.score * 3.6}deg, #E5E4E0 0deg)` }} aria-label={tr("Score financeiro: {score} de 100", { score: data.score })}>
            <div className="grid h-36 w-36 place-items-center rounded-full text-center" style={{ background: "var(--surface)" }}>
              <div><p className="text-4xl font-semibold text-[#1A1C1A]">{data.score}</p><p className="text-xs text-[#6B7068]">{tr("de 100 pontos")}</p></div>
            </div>
          </div>
        </div>
        <div className="flex flex-col justify-center">
          <span className="w-fit rounded-full px-3 py-1 text-sm font-medium" style={{ color: chartColor, background: `${chartColor}18` }}>{tr(levelLabels[data.level])}</span>
          <h2 className="mt-3 text-xl font-semibold text-[#1A1C1A]">{tr("Seu diagnóstico deste mês")}</h2>
          <p className="mt-2 text-sm leading-6 text-[#6B7068]">{tr("A nota considera saldo, reserva, metas, orçamento, economia, atrasos, categorias e projeção. Os fatores sem histórico recebem metade dos pontos e aparecem identificados.")}</p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-[#6B7068]">
            <span><strong className="text-emerald-700">{data.summary.positive}</strong> {tr("fatores positivos")}</span>
            <span><strong className="text-amber-700">{data.summary.attention}</strong> {tr("pedem atenção")}</span>
            <span><strong className="text-[#1A1C1A]">{data.confidence}%</strong> {tr("de confiança dos dados")}</span>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[#1A1C1A]">{tr("Fatores da pontuação")}</h2>
          <p className="mt-1 text-sm text-[#6B7068]">{tr("Cada cartão mostra os pontos, a evidência utilizada e onde agir.")}</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {sortedFactors.map((factor) => {
            const meta = factorMeta[factor.code];
            const style = tone[factor.status];
            const Icon = style.icon;
            return (
              <article key={factor.code} className="rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="rounded-xl p-2" style={{ color: style.color, background: style.bg }}><Icon size={18} /></span>
                    <div><h3 className="font-medium text-[#1A1C1A]">{tr(meta.title)}</h3><p className="text-xs text-[#6B7068]">{tr(factor.status === "good" ? "Bom" : factor.status === "warning" ? "Atenção" : factor.status === "critical" ? "Crítico" : "Dados insuficientes")}</p></div>
                  </div>
                  <p className="whitespace-nowrap font-semibold text-[#1A1C1A]">{factor.points} <span className="text-xs font-normal text-[#6B7068]">/ {factor.weight}</span></p>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#F1EFE7]"><div className="h-full rounded-full" style={{ width: `${factor.weight ? (factor.points / factor.weight) * 100 : 0}%`, background: style.color }} /></div>
                <p className="mt-4 text-sm leading-6 text-[#6B7068]">{factorExplanation(factor, data.currency)}</p>
                <Link to={meta.path} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[#061B4A] hover:underline">{tr("Ver detalhes")} <ArrowRight size={15} /></Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border p-5 text-sm text-[#6B7068]" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h2 className="font-medium text-[#1A1C1A]">{tr("Como a nota é calculada")}</h2>
        <p className="mt-2 leading-6">{tr("Os pesos totalizam 100 pontos. A nota é recalculada com os dados atuais; nenhuma informação é enviada a serviços externos. A pontuação orienta decisões, mas não substitui aconselhamento financeiro profissional.")}</p>
      </section>
    </div>
  );
}
