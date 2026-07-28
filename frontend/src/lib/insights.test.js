import { formatInsight, insightCategory } from "@/lib/insights";

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
