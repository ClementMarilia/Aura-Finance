// New income/expense entries start on a wallet so a "paid" entry always moves
// a wallet balance; otherwise the dashboard and the wallets disagree.
export function defaultAccountFor(accounts, currency) {
  if (!accounts?.length) return null;
  return accounts.find(account => (account.currency || currency) === currency) || accounts[0];
}
