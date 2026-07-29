export const PENDING_DIRECTION = Object.freeze({
  PAY: "pay",
  RECEIVE: "receive",
});

export function pendingDirectionFromType(type) {
  return type === "income" ? PENDING_DIRECTION.RECEIVE : PENDING_DIRECTION.PAY;
}

export function transactionTypeFromPendingDirection(direction) {
  return direction === PENDING_DIRECTION.RECEIVE ? "income" : "expense";
}
