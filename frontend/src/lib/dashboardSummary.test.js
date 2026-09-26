import { monthForecast, monthOverMonth, splitAccounts, topCategories } from "./dashboardSummary";

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
