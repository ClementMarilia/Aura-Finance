const MAX_DECIMALS = 10;

export function roundCalculatorValue(value) {
  if (!Number.isFinite(value)) throw new Error("invalid_result");
  const rounded = Number(value.toFixed(MAX_DECIMALS));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function calculate(left, right, operator) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("invalid_result");

  switch (operator) {
    case "+": return roundCalculatorValue(a + b);
    case "−": return roundCalculatorValue(a - b);
    case "×": return roundCalculatorValue(a * b);
    case "÷":
      if (b === 0) throw new Error("division_by_zero");
      return roundCalculatorValue(a / b);
    default: return b;
  }
}

export function percentageOperand(value, accumulator, operator) {
  const current = Number(value);
  if (!Number.isFinite(current)) throw new Error("invalid_result");
  if ((operator === "+" || operator === "−") && Number.isFinite(Number(accumulator))) {
    return roundCalculatorValue(Number(accumulator) * current / 100);
  }
  return roundCalculatorValue(current / 100);
}

export function toAmountValue(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("invalid_result");
  return String(Number(amount.toFixed(2)));
}
