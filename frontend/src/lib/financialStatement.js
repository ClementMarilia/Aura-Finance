const ENTRY_DIRECTIONS = {
  income: "income",
  transfer_in: "transfer",
  expense: "expense",
  installment: "expense",
  transfer_out: "transfer",
  adjustment: "adjustment",
  initial_balance: "initial_balance",
};

export function statementDirection(kind) {
  return ENTRY_DIRECTIONS[kind] || kind;
}

export function accountRateToBase(account, baseCurrency) {
  if ((account.currency || baseCurrency) === baseCurrency) return 1;
  const rate = Number(account.balance_base_rate);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function buildStatementEntries(accounts, breakdowns, baseCurrency) {
  const accountMap = Object.fromEntries(accounts.map(account => [account.id, account]));
  const rows = breakdowns.flatMap(breakdown => {
    const account = accountMap[breakdown.account_id] || {
      id: breakdown.account_id,
      name: breakdown.account_name,
      currency: breakdown.currency,
    };
    const rate = accountRateToBase(account, baseCurrency);
    let runningBalance = 0;
    return [...(breakdown.entries || [])]
      .sort((a, b) => (
        String(a.date || "").localeCompare(String(b.date || ""))
        || Number(b.kind === "initial_balance") - Number(a.kind === "initial_balance")
        || String(a.id || "").localeCompare(String(b.id || ""))
      ))
      .map(entry => {
        runningBalance = Math.round((runningBalance + Number(entry.amount || 0)) * 100) / 100;
        return {
          ...entry,
          account_id: breakdown.account_id,
          account_name: breakdown.account_name,
          currency: entry.currency || breakdown.currency,
          status: entry.status || "paid",
          direction: statementDirection(entry.kind),
          base_amount: rate === null ? null : Math.round(Number(entry.amount || 0) * rate * 100) / 100,
          running_balance: runningBalance,
        };
      });
  });
  return rows.sort((a, b) => (
    String(b.date || "").localeCompare(String(a.date || ""))
    || String(b.id || "").localeCompare(String(a.id || ""))
  ));
}

export function buildPendingEntries(transactions, accounts, baseCurrency) {
  const accountMap = Object.fromEntries(accounts.map(account => [account.id, account]));
  return transactions
    .filter(transaction => transaction.status !== "paid")
    .flatMap(transaction => {
      if (transaction.type === "transfer") {
        const legs = [];
        const fromAccount = accountMap[transaction.from_account_id];
        const toAccount = accountMap[transaction.to_account_id];
        if (fromAccount) {
          legs.push({
            account: fromAccount,
            amount: -Number(transaction.amount || 0),
            currency: transaction.currency || fromAccount.currency,
            kind: "transfer_out",
          });
        }
        if (toAccount) {
          legs.push({
            account: toAccount,
            amount: Number(transaction.target_amount ?? transaction.amount ?? 0),
            currency: transaction.target_currency || toAccount.currency,
            kind: "transfer_in",
          });
        }
        return legs.map(leg => {
          const rate = accountRateToBase(leg.account, baseCurrency);
          return {
            ...transaction,
            id: `${transaction.id}:${leg.kind}`,
            account_id: leg.account.id,
            account_name: leg.account.name,
            amount: leg.amount,
            currency: leg.currency,
            kind: leg.kind,
            direction: "transfer",
            base_amount: rate === null ? null : Math.round(leg.amount * rate * 100) / 100,
            impacting: false,
          };
        });
      }

      const account = accountMap[transaction.account_id];
      if (!account) return [];
      const signedAmount = transaction.type === "expense"
        ? -Number(transaction.amount || 0)
        : Number(transaction.amount || 0);
      const rate = accountRateToBase(account, baseCurrency);
      return [{
        ...transaction,
        account_name: account.name,
        amount: signedAmount,
        currency: transaction.currency || account.currency,
        kind: transaction.source === "installment" ? "installment" : transaction.type,
        direction: transaction.type,
        base_amount: rate === null ? null : Math.round(signedAmount * rate * 100) / 100,
        impacting: false,
      }];
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

export function filterStatementEntries(entries, filters) {
  return entries.filter(entry => {
    if (filters.account_id && entry.account_id !== filters.account_id) return false;
    if (filters.start_date && String(entry.date || "") < filters.start_date) return false;
    if (filters.end_date && String(entry.date || "") > filters.end_date) return false;
    if (filters.direction && entry.direction !== filters.direction) return false;
    if (filters.category_id && entry.category_id !== filters.category_id) return false;
    if (filters.currency && entry.currency !== filters.currency) return false;
    return true;
  });
}

export function statementTotals(entries) {
  return entries.reduce((totals, entry) => {
    if (entry.kind === "initial_balance" || entry.base_amount === null) return totals;
    if (entry.base_amount >= 0) totals.income += entry.base_amount;
    else totals.expense += Math.abs(entry.base_amount);
    return totals;
  }, { income: 0, expense: 0 });
}
