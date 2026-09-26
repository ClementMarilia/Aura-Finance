import { installmentAmounts, purchaseProgress } from "./installments";

test("parcels add up to the total and differ by at most one cent", () => {
  expect(installmentAmounts(100, 3)).toEqual([33.34, 33.33, 33.33]);
  const amounts = installmentAmounts(99.99, 12);
  expect(Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(99.99);
  expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(0.0100001);
});

test("invalid input gives no preview", () => {
  expect(installmentAmounts(0, 3)).toEqual([]);
  expect(installmentAmounts(100, 0)).toEqual([]);
  expect(installmentAmounts("", "")).toEqual([]);
});

test("progress picks the lowest pending parcel as next", () => {
  const progress = purchaseProgress({
    installments_list: [
      { number: 1, amount: 120, status: "paid" },
      { number: 3, amount: 120, status: "pending" },
      { number: 2, amount: 120, status: "pending" },
    ],
  });
  expect(progress).toMatchObject({ paidCount: 1, total: 3, paidAmount: 120, pendingAmount: 240 });
  expect(progress.next.number).toBe(2);
});
