// Pure helpers behind the dashboard. They only reshape the /dashboard and
// /accounts payloads, so every number stays traceable to the API.

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

// "Quanto vai sobrar": the month result (income − expense, pending included)
// plus what is still to be received, minus shared debts that are not yet in
// the expense total. Pending own expenses and installments are already part
// of `expense`, so they are not subtracted twice.
export function monthForecast(data) {
  const income = Number(data?.income) || 0;
  const expense = Number(data?.expense) || 0;
  const receivable = Number(data?.receivable_total) || 0;
  const payable = Number(data?.pending_payable) || 0;
  const sharedPayable = Number(data?.shared_payable) || 0;
  const leftover = income - expense + receivable - sharedPayable;
  const available = income + receivable;
  const committed = expense + sharedPayable;
  return {
    leftover: round2(leftover),
    receivable: round2(receivable),
    payable: round2(payable),
    income: round2(income),
    expense: round2(expense),
    // Share of the money coming in this month that is already committed.
    committedRatio: available > 0 ? Math.min(committed / available, 1) : (committed > 0 ? 1 : 0),
  };
}

// Percent change of `key` between the last two months of the evolution
// series; null when there is nothing meaningful to compare against.
export function monthOverMonth(evolution, key) {
  if (!Array.isArray(evolution) || evolution.length < 2) return null;
  const current = Number(evolution[evolution.length - 1]?.[key]) || 0;
  const previous = Number(evolution[evolution.length - 2]?.[key]) || 0;
  if (previous === 0) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

// Largest categories first, the remainder folded into a single "others" row.
export function topCategories(breakdown, limit = 5, othersLabel = "Outros") {
  const items = (Array.isArray(breakdown) ? breakdown : [])
    .filter((item) => (Number(item?.amount) || 0) > 0)
    .sort((a, b) => b.amount - a.amount);
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  if (total === 0) return { total: 0, items: [] };
  const head = items.slice(0, limit);
  const rest = items.slice(limit).reduce((sum, item) => sum + item.amount, 0);
  const rows = rest > 0
    ? [...head, { category: othersLabel, color: "#A8ABA0", amount: rest }]
    : head;
  return {
    total: round2(total),
    items: rows.map((item) => ({
      ...item,
      amount: round2(item.amount),
      percent: Math.round((item.amount / total) * 100),
    })),
  };
}

// Wallets worth showing on the dashboard: non-zero balances, biggest first.
export function splitAccounts(accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  const value = (account) => Number(account?.balance_base ?? account?.balance) || 0;
  const active = list
    .filter((account) => Math.abs(value(account)) >= 0.005)
    .sort((a, b) => Math.abs(value(b)) - Math.abs(value(a)));
  return {
    total: round2(list.reduce((sum, account) => sum + value(account), 0)),
    all: list,
    active,
    emptyCount: list.length - active.length,
  };
}
