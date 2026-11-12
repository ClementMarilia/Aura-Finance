import { installmentAmounts, installmentPayload, purchaseProgress, purchaseTotal } from "./installments";

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

test("per-parcel mode multiplies by the count", () => {
  expect(purchaseTotal(350, 6, "per_parcel")).toBe(2100);
  expect(purchaseTotal(2100, 6, "total")).toBe(2100);
});

test("prior parcels count as already paid", () => {
  const progress = purchaseProgress({
    installments: 6, start_number: 4,
    installments_list: [{ number: 4, amount: 100, status: "pending" }],
  });
  expect(progress).toMatchObject({ paidCount: 3, total: 6 });
});

test("payload drops UI-only fields the API would reject", () => {
  const payload = installmentPayload({
    description: "geladeira", total_amount: "350", installments: "6", amount_mode: "per_parcel",
    first_date: "2026-10-18", start_number: 1, category_id: "", account_id: "a1", currency: "BRL",
    payment_method: "",
  });
  expect(payload).not.toHaveProperty("amount_mode");
  expect(payload).toMatchObject({ total_amount: 2100, installments: 6, start_number: 1, category_id: null });
});

test("AI installment draft keeps per-parcel values and current position", () => {
  const { applyInstallmentDraft } = require("./installments");
  const form = applyInstallmentDraft({}, { description: "Notebook", amount: 100, amount_mode: "per_parcel", installments: 6, start_number: 3, date: "2026-12-15", currency: "EUR", account_id: "revolut" }, "EUR");
  expect(installmentPayload(form)).toMatchObject({ total_amount: 600, installments: 6, start_number: 3, first_date: "2026-12-15", account_id: "revolut" });
  expect(applyInstallmentDraft({ installments: 2, amount_mode: "total", first_date: "2026-11-12" }, { description: "Unknown", amount: 100 }, "EUR")).toMatchObject({ installments: "", amount_mode: "", first_date: "" });
});
