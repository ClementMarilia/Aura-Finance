import { fmtMoney } from "@/lib/api";
import { translate as tr } from "@/i18n";

export function formatInsight(insight, currency) {
  const data = insight?.data || {};
  const amount = (value, selectedCurrency = currency) => (
    fmtMoney(Number(value || 0), selectedCurrency)
  );
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
    savings_opportunity: (() => {
      const categories = data.categories || [];
      const first = categories[0] || {};
      if (categories.length === 1) {
        return {
          title: tr("Oportunidade de economia"),
          message: tr("Você gastou {amount} acima do seu padrão recente com {category}.", {
            amount: amount(first.excess_to_date),
            category: first.category,
          }),
          recommendation: first.daily_limit > 0
            ? tr("Para encerrar o mês dentro desse padrão, limite os gastos restantes nessa categoria a {amount} por dia.", {
                amount: amount(first.daily_limit),
              })
            : tr("Você já ultrapassou o padrão mensal estimado dessa categoria. Evite novos gastos nela até o fim do mês."),
          impact: tr("Impacto estimado: {amount} por mês.", {
            amount: amount(data.monthly_impact),
          }),
        };
      }
      return {
        title: tr("Oportunidade de economia"),
        message: tr("{count} categorias estão acima do seu padrão recente: {categories}.", {
          count: categories.length,
          categories: categories.map((item) => item.category).join(", "),
        }),
        recommendation: tr("Retomar o ritmo anterior nessas categorias pode reduzir seus gastos em cerca de {amount} por mês.", {
          amount: amount(data.monthly_impact),
        }),
        impact: tr("Estimativa baseada no ritmo diário dos dois períodos comparados."),
      };
    })(),
    spending_limit: {
      title: tr("Limite de gastos até o fim do mês"),
      message: tr("Depois das despesas registradas, você ainda pode gastar {amount} neste mês.", {
        amount: amount(data.available_to_spend),
      }),
      recommendation: tr("Para manter esse orçamento, use como referência o limite de {amount} por dia durante os próximos {days} dias.", {
        amount: amount(data.daily_limit),
        days: data.days_remaining,
      }),
    },
    account_growth_streak: {
      title: tr("Conta crescendo"),
      message: tr("{account} cresceu por {months} meses consecutivos, acumulando {amount}.", {
        account: data.account,
        months: data.months,
        amount: amount(data.growth, data.currency),
      }),
    },
    category_acceleration: {
      title: tr("Categoria acelerando"),
      message: tr("Os gastos com {category} cresceram novamente: agora {percent}% sobre o mês anterior.", {
        category: data.category,
        percent: data.latest_percent,
      }),
      recommendation: tr("Revise os lançamentos desta categoria antes que o novo ritmo vire padrão."),
    },
    unusual_expense: {
      title: tr("Gasto fora do habitual"),
      message: tr("{description} foi de {amount}; a mediana histórica desta categoria é {median}.", {
        description: data.description,
        amount: amount(data.amount),
        median: amount(data.median),
      }),
    },
    daily_spending_above_normal: {
      title: tr("Média diária acima do normal"),
      message: tr("Você está gastando {amount} por dia, {percent}% acima do padrão recente.", {
        amount: amount(data.current_daily),
        percent: data.percent,
      }),
      recommendation: tr("Use {amount} por dia como referência para retomar seu ritmo habitual.", {
        amount: amount(data.normal_daily),
      }),
    },
    income_commitment: {
      title: tr("Renda comprometida"),
      message: tr("As despesas recorrentes consomem {percent}% da sua renda média.", {
        percent: data.fixed_share,
      }),
      recommendation: tr("{name} representa {percent}% da renda: {amount} por mês.", {
        name: data.largest_name,
        percent: data.largest_share,
        amount: amount(data.largest_amount),
      }),
    },
    wealth_evolution: {
      title: tr("Evolução patrimonial"),
      message: data.direction === "up"
        ? tr("Seu patrimônio aumentou {amount} nos últimos três meses.", {
            amount: amount(Math.abs(data.delta)),
          })
        : tr("Seu patrimônio diminuiu {amount} nos últimos três meses.", {
            amount: amount(Math.abs(data.delta)),
          }),
    },
    goal_progress: {
      title: tr("Acompanhamento de meta"),
      message: tr("{title} está em {percent}%: faltam {amount}.", {
        title: data.title,
        percent: data.progress_percent,
        amount: amount(Number(data.target_amount || 0) - Number(data.current_amount || 0)),
      }),
      recommendation: data.forecast_date
        ? tr("Mantendo o ritmo de {amount} por mês, a conclusão está prevista para {date}.", {
            amount: amount(data.monthly_pace),
            date: new Intl.DateTimeFormat(undefined, {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(`${data.forecast_date}T00:00:00Z`)),
          })
        : tr("Registre pelo menos dois aportes para calcular a previsão de conclusão."),
      impact: data.behind_schedule
        ? tr("No ritmo atual, esta meta pode ultrapassar o prazo definido.")
        : null,
    },
    recurring_charge_detected: {
      title: tr("Possível cobrança recorrente"),
      message: tr("{description} apareceu {count} vezes, aproximadamente a cada {days} dias.", {
        description: data.description,
        count: data.occurrences,
        days: data.interval_days,
      }),
      recommendation: tr("Confirme se é uma assinatura ou conta fixa e cadastre-a em Recorrências."),
    },
  };

  return templates[insight?.code] || fallback;
}

const EVIDENCE_LABELS = {
  income_to_date: "Receitas consideradas",
  expense_to_date: "Despesas consideradas",
  difference: "Diferença calculada",
  savings_rate: "Taxa de economia",
  category_current: "Categoria no período atual",
  category_previous: "Categoria no período anterior",
  variation: "Variação calculada",
  current_balance: "Saldo atual das carteiras",
  pending_outgoing: "Saídas pendentes",
  projected_balance: "Saldo projetado",
  due_date: "Data de vencimento",
  amount: "Valor considerado",
  overdue_settlements: "Acertos pendentes",
  minimum_delay: "Atraso mínimo",
  similar_entries: "Lançamentos semelhantes",
  transaction_date: "Data dos lançamentos",
  estimated_monthly_impact: "Impacto mensal estimado",
  categories_analyzed: "Categorias analisadas",
  comparable_days: "Dias comparados",
  realized_income: "Receitas já realizadas",
  realized_expense: "Despesas já realizadas",
  pending_income: "Receitas pendentes",
  pending_expense: "Despesas pendentes",
  days_remaining: "Dias restantes",
  consecutive_months: "Meses consecutivos",
  account_growth: "Crescimento acumulado",
  starting_balance: "Saldo no início",
  ending_balance: "Saldo atual",
  three_month_values: "Valores dos três meses",
  previous_growth: "Crescimento anterior",
  latest_growth: "Crescimento mais recente",
  transaction_amount: "Valor do lançamento",
  category_median: "Mediana histórica da categoria",
  historical_entries: "Lançamentos históricos analisados",
  current_daily_average: "Média diária atual",
  historical_daily_average: "Média diária histórica",
  months_analyzed: "Meses analisados",
  average_monthly_income: "Renda média mensal",
  recurring_expenses: "Despesas recorrentes mensais",
  income_committed: "Renda comprometida",
  starting_wealth: "Patrimônio inicial",
  current_wealth: "Patrimônio atual",
  wealth_change: "Variação patrimonial",
  goal_progress: "Progresso da meta",
  amount_remaining: "Valor restante",
  monthly_contribution_pace: "Ritmo mensal de aportes",
  forecast_completion: "Previsão de conclusão",
  occurrences: "Ocorrências encontradas",
  typical_amount: "Valor típico",
  average_interval: "Intervalo médio",
};

export function formatInsightEvidence(insight, currency) {
  return (insight?.evidence || []).map((entry) => {
    let value = entry.value;
    if (entry.format === "money") value = fmtMoney(Number(value || 0), currency);
    if (entry.format === "money_list") {
      value = (value || []).map((item) => fmtMoney(Number(item || 0), currency)).join(" · ");
    }
    if (entry.format === "percent") value = `${Number(value || 0)}%`;
    if (entry.format === "days") value = tr("{count} dias", { count: Number(value || 0) });
    if (entry.format === "months") value = tr("{count} meses", { count: Number(value || 0) });
    return {
      label: tr(EVIDENCE_LABELS[entry.key] || entry.key),
      value,
    };
  });
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
