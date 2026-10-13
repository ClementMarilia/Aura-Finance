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

// Wallet balances grouped by wallet type, in a fixed axis order so the
// "Estrutura" radar keeps its shape between visits. Card debt counts by its
// size: the radar shows where money sits, not its sign.
export const ACCOUNT_TYPE_ORDER = ["checking", "savings", "investment", "card", "cash", "other"];

export function accountStructure(accounts) {
  const totals = new Map(ACCOUNT_TYPE_ORDER.map((type) => [type, 0]));
  (Array.isArray(accounts) ? accounts : []).forEach((account) => {
    const type = totals.has(account?.type) ? account.type : "other";
    const value = Math.abs(Number(account?.balance_base ?? account?.balance) || 0);
    totals.set(type, totals.get(type) + value);
  });
  return ACCOUNT_TYPE_ORDER
    .map((type) => ({ type, value: round2(totals.get(type)) }))
    .filter((row) => row.type !== "other" || row.value > 0);
}

// Totals use the amounts already converted to the user's currency by /goals;
// each row keeps its own currency for display.
export function goalsSummary(goals, limit = 4) {
  const list = Array.isArray(goals) ? goals : [];
  const base = (goal, key) => Number(goal?.[`base_${key}`] ?? goal?.[key]) || 0;
  const saved = list.reduce((sum, goal) => sum + base(goal, "current_amount"), 0);
  const target = list.reduce((sum, goal) => sum + base(goal, "target_amount"), 0);
  const rows = list.map((goal) => {
    const goalTarget = Number(goal?.target_amount) || 0;
    const current = Number(goal?.current_amount) || 0;
    return {
      ...goal,
      percent: goalTarget > 0 ? Math.round((current / goalTarget) * 100) : 0,
    };
  });
  // Unfinished goals first: they are the ones that still need attention.
  const ordered = [
    ...rows.filter((goal) => goal.percent < 100),
    ...rows.filter((goal) => goal.percent >= 100),
  ];
  return {
    saved: round2(saved),
    target: round2(target),
    percent: target > 0 ? Math.round((saved / target) * 100) : 0,
    rows: ordered.slice(0, limit),
    hidden: Math.max(0, ordered.length - limit),
  };
}

// Result of the previous year, the selected year and, when the selected year
// is the current one and a projection exists, the next year (average monthly
// net × 12). The projection is based on recent history, so it says nothing
// about years further away.
export function annualBalances(report, projection, currentYear) {
  if (!report) return [];
  const rows = [
    { year: report.prev_year, balance: round2(report.prev_totals?.balance), projected: false },
    { year: report.year, balance: round2(report.totals?.balance), projected: false },
  ];
  const avg = Number(projection?.avg_monthly_net);
  if (projection && Number.isFinite(avg) && report.year === currentYear) {
    rows.push({ year: report.year + 1, balance: round2(avg * 12), projected: true });
  }
  return rows;
}
