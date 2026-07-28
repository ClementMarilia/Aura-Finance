import { fmtMoney } from "@/lib/api";
import { translate as tr } from "@/i18n";

export function formatInsight(insight, currency) {
  const data = insight?.data || {};
  const amount = (value) => fmtMoney(Number(value || 0), currency);
  const fallback = {
    title: tr(insight?.title || ""),
    message: tr(insight?.message || ""),
  };

  const templates = {
    spending_above_income: {
      title: tr("Gastos acima da receita"),
      message: tr("Suas despesas superaram a receita em {amount} neste mês.", {
        amount: amount(data.amount),
      }),
    },
    savings_rate: {
      title: tr("Economia do mês"),
      message: tr("Você preservou {rate}% da sua receita até agora ({amount}).", {
        rate: data.rate,
        amount: amount(data.amount),
      }),
    },
    category_growth: {
      title: tr("Categoria em alta"),
      message: tr("Seus gastos com {category} aumentaram {percent}% no mesmo intervalo do mês anterior.", {
        category: data.category,
        percent: data.percent,
      }),
    },
    negative_balance_forecast: {
      title: tr("Saldo em risco"),
      message: tr("Com os lançamentos previstos, seu saldo pode ficar negativo no dia {day}.", {
        day: String(data.date || "").slice(-2).replace(/^0/, ""),
      }),
    },
    month_covered: {
      title: tr("Contas previstas cobertas"),
      message: tr("Seu saldo cobre os lançamentos pendentes do mês, com previsão de {amount} ao final.", {
        amount: amount(data.projected_balance),
      }),
    },
    recurrence_due: {
      title: tr("Conta recorrente próxima"),
      message: data.days === 0
        ? tr("{description} vence hoje: {amount}.", {
            description: data.description,
            amount: amount(data.amount),
          })
        : data.days === 1
          ? tr("{description} vence amanhã: {amount}.", {
              description: data.description,
              amount: amount(data.amount),
            })
          : tr("{description} vence em {days} dias: {amount}.", {
              description: data.description,
              days: data.days,
              amount: amount(data.amount),
            }),
    },
    overdue_settlements: {
      title: tr("Acertos aguardando"),
      message: data.count === 1
        ? tr("Você possui 1 acerto pendente há mais de 15 dias.")
        : tr("Você possui {count} acertos pendentes há mais de 15 dias.", {
            count: data.count,
          }),
    },
    possible_duplicate: {
      title: tr("Possível duplicidade"),
      message: tr("Encontramos {count} lançamentos semelhantes de {amount} no mesmo dia.", {
        count: data.count,
        amount: amount(data.amount),
      }),
    },
    insufficient_data: {
      title: tr("Sem dados suficientes"),
      message: tr("Continue registrando receitas e despesas para receber análises úteis."),
    },
  };

  return templates[insight?.code] || fallback;
}

export function insightCategory(severity) {
  return {
    critical: tr("Crítico"),
    warning: tr("Atenção"),
    opportunity: tr("Oportunidade"),
    good: tr("Positivo"),
    info: tr("Informativo"),
  }[severity] || tr("Informativo");
}
