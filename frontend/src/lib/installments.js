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

export function purchaseProgress(purchase) {
  const parcels = purchase?.installments_list || [];
  const paid = parcels.filter((item) => item.status === "paid");
  const pending = parcels.filter((item) => item.status !== "paid");
  const sum = (items) => Math.round(items.reduce((acc, item) => acc + (Number(item.amount) || 0), 0) * 100) / 100;
  return {
    paidCount: paid.length,
    total: parcels.length || purchase?.installments || 0,
    paidAmount: sum(paid),
    pendingAmount: sum(pending),
    next: pending.slice().sort((a, b) => a.number - b.number)[0] || null,
  };
}
