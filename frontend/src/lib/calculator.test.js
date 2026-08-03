import { calculate, percentageOperand, roundCalculatorValue, toAmountValue } from "./calculator";

describe("financial calculator", () => {
  test("calculates the four basic operations", () => {
    expect(calculate(12, 3, "+")).toBe(15);
    expect(calculate(12, 3, "−")).toBe(9);
    expect(calculate(12, 3, "×")).toBe(36);
    expect(calculate(12, 3, "÷")).toBe(4);
  });

  test("blocks division by zero", () => {
    expect(() => calculate(12, 0, "÷")).toThrow("division_by_zero");
  });

  test("uses percentages relative to the accumulator for addition and subtraction", () => {
    expect(percentageOperand(10, 120, "+")).toBe(12);
    expect(calculate(120, percentageOperand(10, 120, "+"), "+")).toBe(132);
    expect(percentageOperand(10, 120, "−")).toBe(12);
  });

  test("uses a decimal percentage for multiplication and standalone values", () => {
    expect(percentageOperand(10, 120, "×")).toBe(0.1);
    expect(percentageOperand(5, null, null)).toBe(0.05);
  });

  test("rounds floating point noise and returns a two-decimal compatible amount", () => {
    expect(roundCalculatorValue(0.1 + 0.2)).toBe(0.3);
    expect(toAmountValue(100 / 3)).toBe("33.33");
  });
});
