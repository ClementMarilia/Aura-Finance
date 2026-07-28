import { formatInsight, formatInsightEvidence, insightCategory } from "@/lib/insights";

jest.mock("@/i18n", () => ({
  translate: (message, variables = {}) => message.replace(
    /\{(\w+)\}/g,
    (_, key) => String(variables[key] ?? ""),
  ),
}));

jest.mock("@/lib/api", () => ({
  fmtMoney: (value, currency) => `${currency} ${Number(value).toFixed(2)}`,
}));

test("formats structured category growth without depending on backend prose", () => {
  const result = formatInsight({
    code: "category_growth",
    data: { category: "Alimentação", percent: 22 },
  }, "EUR");

  expect(result.title).toBe("Categoria em alta");
  expect(result.message).toBe(
    "Seus gastos com Alimentação aumentaram 22% no mesmo intervalo do mês anterior.",
  );
});

test("formats recurrence due today and maps critical category", () => {
  const result = formatInsight({
    code: "recurrence_due",
    data: { description: "Netflix", days: 0, amount: 12.9 },
  }, "EUR");

  expect(result.message).toBe("Netflix vence hoje: EUR 12.90.");
  expect(insightCategory("critical")).toBe("Crítico");
});

test("formats a practical category recommendation and its estimated impact", () => {
  const result = formatInsight({
    code: "savings_opportunity",
    data: {
      monthly_impact: 74,
      categories: [{
        category: "Alimentação",
        excess_to_date: 74,
        daily_limit: 16,
      }],
    },
  }, "EUR");

  expect(result.message).toBe(
    "Você gastou EUR 74.00 acima do seu padrão recente com Alimentação.",
  );
  expect(result.recommendation).toContain("EUR 16.00 por dia");
  expect(result.impact).toBe("Impacto estimado: EUR 74.00 por mês.");
});

test("formats remaining budget evidence without backend prose", () => {
  const result = formatInsight({
    code: "spending_limit",
    data: {
      available_to_spend: 400,
      daily_limit: 100,
      days_remaining: 4,
    },
    evidence: [
      { key: "realized_income", value: 2000, format: "money" },
      { key: "days_remaining", value: 4, format: "days" },
    ],
  }, "EUR");
  const evidence = formatInsightEvidence({
    evidence: [
      { key: "realized_income", value: 2000, format: "money" },
      { key: "days_remaining", value: 4, format: "days" },
    ],
  }, "EUR");

  expect(result.message).toContain("EUR 400.00");
  expect(result.recommendation).toContain("EUR 100.00 por dia");
  expect(evidence).toEqual([
    { label: "Receitas já realizadas", value: "EUR 2000.00" },
    { label: "Dias restantes", value: "4 dias" },
  ]);
});
