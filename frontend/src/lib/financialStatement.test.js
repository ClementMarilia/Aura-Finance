import {
  buildPendingEntries,
  buildStatementEntries,
  filterStatementEntries,
  statementTotals,
} from "./financialStatement";

const accounts = [
  { id: "eur", name: "Revolut", currency: "EUR", balance_base_rate: 1 },
  { id: "usd", name: "Dólar", currency: "USD", balance_base_rate: 0.8 },
];

test("builds a running balance per account and converts the consolidated value", () => {
  const rows = buildStatementEntries(accounts, [{
    account_id: "usd",
    account_name: "Dólar",
    currency: "USD",
    entries: [
      { id: "expense", kind: "expense", date: "2026-02-01", amount: -20 },
      { id: "initial", kind: "initial_balance", date: "2026-01-01", amount: 100 },
      { id: "income", kind: "income", date: "2026-01-10", amount: 50 },
    ],
  }], "EUR");

  expect(rows.find(row => row.id === "expense")).toMatchObject({
    running_balance: 130,
    base_amount: -16,
    account_name: "Dólar",
  });
  expect(statementTotals(rows)).toEqual({ income: 40, expense: 16 });
});

test("keeps pending items separate and signed without affecting a running balance", () => {
  const rows = buildPendingEntries([{
    id: "pending-1",
    type: "expense",
    status: "pending",
    account_id: "eur",
    amount: 23.4,
    date: "2026-07-29",
  }], accounts, "EUR");

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    amount: -23.4,
    base_amount: -23.4,
    impacting: false,
  });
  expect(rows[0].running_balance).toBeUndefined();
});

test("filters by period, account, direction, category and currency", () => {
  const entries = [
    {
      id: "keep", date: "2026-07-10", account_id: "eur",
      direction: "expense", category_id: "food", currency: "EUR",
    },
    {
      id: "drop", date: "2026-06-10", account_id: "eur",
      direction: "expense", category_id: "food", currency: "EUR",
    },
  ];
  expect(filterStatementEntries(entries, {
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    account_id: "eur",
    direction: "expense",
    category_id: "food",
    currency: "EUR",
  }).map(item => item.id)).toEqual(["keep"]);
});
