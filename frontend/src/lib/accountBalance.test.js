import { reconciliationDifference } from "./accountBalance";

describe("reconciliationDifference", () => {
  test("calculates a negative adjustment when the real balance is lower", () => {
    expect(reconciliationDifference("0", 23.4)).toBe(-23.4);
  });

  test("calculates a positive adjustment when the real balance is higher", () => {
    expect(reconciliationDifference("125.10", 100)).toBe(25.1);
  });

  test("normalizes cent rounding and rejects invalid values", () => {
    expect(reconciliationDifference(10.004, 10)).toBe(0);
    expect(reconciliationDifference("", 10)).toBeNull();
    expect(reconciliationDifference("not-a-number", 10)).toBeNull();
  });
});
