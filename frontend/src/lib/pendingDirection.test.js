import {
  PENDING_DIRECTION,
  pendingDirectionFromType,
  transactionTypeFromPendingDirection,
} from "@/lib/pendingDirection";

test("maps a pending expense to an amount the user has to pay", () => {
  expect(pendingDirectionFromType("expense")).toBe(PENDING_DIRECTION.PAY);
});

test("maps pending income to an amount the user has to receive", () => {
  expect(pendingDirectionFromType("income")).toBe(PENDING_DIRECTION.RECEIVE);
});

test("maps pay direction back to an expense", () => {
  expect(transactionTypeFromPendingDirection(PENDING_DIRECTION.PAY)).toBe("expense");
});

test("maps receive direction back to income", () => {
  expect(transactionTypeFromPendingDirection(PENDING_DIRECTION.RECEIVE)).toBe("income");
});
