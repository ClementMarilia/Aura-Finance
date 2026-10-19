// Mirrors backend installment_amounts: split in whole cents, leftover cents
// one each to the first parcels, so the preview matches what is saved.
export function installmentAmounts(total, count) {
  const n = Math.floor(Number(count));
  const cents = Math.round((Number(total) || 0) * 100);
  if (!n || n < 1 || cents <= 0) return [];
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}

// "por parcela" mode: the user types one parcel, the purchase total is parcel x count.
export function purchaseTotal(amount, count, mode) {
  const value = Number(amount) || 0;
  if (mode !== "per_parcel") return value;
  return Math.round(value * (Math.floor(Number(count)) || 0) * 100) / 100;
}

export function purchaseProgress(purchase) {
  const parcels = purchase?.installments_list || [];
  const prior = Math.max((Number(purchase?.start_number) || 1) - 1, 0);
  const paid = parcels.filter((item) => item.status === "paid");
  const pending = parcels.filter((item) => item.status !== "paid");
  const sum = (items) => Math.round(items.reduce((acc, item) => acc + (Number(item.amount) || 0), 0) * 100) / 100;
  return {
    paidCount: paid.length + prior,
    total: purchase?.installments || parcels.length || 0,
    paidAmount: sum(paid),
    pendingAmount: sum(pending),
    next: pending.slice().sort((a, b) => a.number - b.number)[0] || null,
  };
}
