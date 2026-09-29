import {
  accountStructure, annualBalances, goalsSummary, monthForecast, monthOverMonth, splitAccounts, topCategories,
} from "./dashboardSummary";

describe("monthForecast", () => {
  test("adds receivables and subtracts shared debts not yet in expenses", () => {
    const forecast = monthForecast({
      income: 1819.99,
      expense: 1414.43,
      receivable_total: 100,
      pending_payable: 250,
      shared_payable: 40,
    });
    expect(forecast.leftover).toBe(465.56);
    expect(forecast.receivable).toBe(100);
    expect(forecast.payable).toBe(250);
  });

  test("goes negative when the month does not close", () => {
    expect(monthForecast({ income: 100, expense: 300 }).leftover).toBe(-200);
  });

  test("reports how much of the incoming money is committed, capped at 100%", () => {
    expect(monthForecast({ income: 1000, expense: 250 }).committedRatio).toBe(0.25);
    expect(monthForecast({ income: 100, expense: 300 }).committedRatio).toBe(1);
    expect(monthForecast({ income: 0, expense: 0 }).committedRatio).toBe(0);
    expect(monthForecast({ income: 0, expense: 10 }).committedRatio).toBe(1);
  });

  test("tolerates a missing payload", () => {
    expect(monthForecast(undefined).leftover).toBe(0);
  });
});

describe("monthOverMonth", () => {
  const evolution = [
    { income: 1000, expense: 800 },
    { income: 1200, expense: 400 },
  ];

  test("compares the last two months", () => {
    expect(monthOverMonth(evolution, "income")).toBe(20);
    expect(monthOverMonth(evolution, "expense")).toBe(-50);
  });

  test("returns null when there is no base to compare", () => {
    expect(monthOverMonth([{ income: 0 }, { income: 50 }], "income")).toBeNull();
    expect(monthOverMonth([{ income: 50 }], "income")).toBeNull();
    expect(monthOverMonth(null, "income")).toBeNull();
  });
});

describe("topCategories", () => {
  const breakdown = [
    { category: "Moradia", color: "#111", amount: 550 },
    { category: "Lazer", color: "#222", amount: 50 },
    { category: "Mercado", color: "#333", amount: 300 },
    { category: "Vazio", color: "#444", amount: 0 },
    { category: "Saúde", color: "#555", amount: 100 },
  ];

  test("sorts, computes shares and folds the tail into others", () => {
    const result = topCategories(breakdown, 2, "Outros");
    expect(result.total).toBe(1000);
    expect(result.items.map((item) => [item.category, item.percent])).toEqual([
      ["Moradia", 55],
      ["Mercado", 30],
      ["Outros", 15],
    ]);
  });

  test("is empty without spending", () => {
    expect(topCategories([], 5)).toEqual({ total: 0, items: [] });
  });
});

describe("splitAccounts", () => {
  test("keeps non-zero wallets, biggest first, and counts empty ones", () => {
    const result = splitAccounts([
      { id: "a", balance: 0 },
      { id: "b", balance: 392.06 },
      { id: "c", balance: -608.13, balance_base: -102.94 },
      { id: "d", balance: 0 },
    ]);
    expect(result.active.map((account) => account.id)).toEqual(["b", "c"]);
    expect(result.emptyCount).toBe(2);
    expect(result.total).toBe(289.12);
  });
});

describe("accountStructure", () => {
  test("groups balances by wallet type in a fixed order, using base amounts", () => {
    const rows = accountStructure([
      { type: "savings", balance: 100, balance_base: 110 },
      { type: "checking", balance: 50 },
      { type: "card", balance: -80 },
      { type: "checking", balance: 25 },
    ]);
    expect(rows.map((row) => row.type)).toEqual(["checking", "savings", "investment", "card", "cash"]);
    expect(rows.find((row) => row.type === "checking").value).toBe(75);
    expect(rows.find((row) => row.type === "savings").value).toBe(110);
    expect(rows.find((row) => row.type === "card").value).toBe(80);
  });

  test("shows the 'other' axis only when it holds money", () => {
    expect(accountStructure([]).some((row) => row.type === "other")).toBe(false);
    expect(accountStructure([{ type: "mystery", balance: 10 }]).find((row) => row.type === "other").value).toBe(10);
  });
});

describe("goalsSummary", () => {
  const goals = [
    { id: "a", target_amount: 100, current_amount: 120, base_target_amount: 100, base_current_amount: 120 },
    { id: "b", target_amount: 1000, current_amount: 250, currency: "USD", base_target_amount: 900, base_current_amount: 225 },
    { id: "c", target_amount: 200, current_amount: 50 },
  ];

  test("totals use converted amounts and unfinished goals come first", () => {
    const summary = goalsSummary(goals, 2);
    expect(summary.saved).toBe(395);
    expect(summary.target).toBe(1200);
    expect(summary.percent).toBe(33);
    expect(summary.rows.map((goal) => goal.id)).toEqual(["b", "c"]);
    expect(summary.rows[0].percent).toBe(25);
    expect(summary.hidden).toBe(1);
  });

  test("handles no goals", () => {
    expect(goalsSummary(undefined)).toEqual({ saved: 0, target: 0, percent: 0, rows: [], hidden: 0 });
  });
});

describe("annualBalances", () => {
  const report = { year: 2026, prev_year: 2025, totals: { balance: 900 }, prev_totals: { balance: -100 } };

  test("adds next year's projection only for the current year", () => {
    expect(annualBalances(report, { avg_monthly_net: 50 }, 2026)).toEqual([
      { year: 2025, balance: -100, projected: false },
      { year: 2026, balance: 900, projected: false },
      { year: 2027, balance: 600, projected: true },
    ]);
    expect(annualBalances(report, { avg_monthly_net: 50 }, 2027)).toHaveLength(2);
    expect(annualBalances(report, null, 2026)).toHaveLength(2);
  });

  test("returns nothing before the report loads", () => {
    expect(annualBalances(null, null, 2026)).toEqual([]);
  });
});
