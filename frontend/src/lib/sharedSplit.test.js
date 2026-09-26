import { splitCheck } from "./sharedSplit";

const people = (key, ...values) => values.map((v) => ({ [key]: v }));

test("manual shares must add up to the total", () => {
  expect(splitCheck(100, "manual", people("amount", 60, 40))).toMatchObject({ valid: true, remaining: 0 });
  expect(splitCheck(100, "manual", people("amount", 30, 30))).toMatchObject({ valid: false, remaining: 40 });
  expect(splitCheck(100, "manual", people("amount", 80, 30))).toMatchObject({ valid: false, remaining: -10 });
  expect(splitCheck(100, "manual", people("amount", 33.33, 33.33, 33.33)).valid).toBe(true);
});

test("percentages must add up to 100", () => {
  expect(splitCheck(90, "percent", people("percent", 50, 50)).valid).toBe(true);
  expect(splitCheck(90, "percent", people("percent", 50, 30))).toMatchObject({ valid: false, remaining: 20 });
  expect(splitCheck(90, "percent", people("percent", "", 100)).valid).toBe(true);
});

test("negative values are rejected and equal split only needs participants", () => {
  expect(splitCheck(100, "manual", people("amount", 120, -20))).toMatchObject({ valid: false, kind: "negative" });
  expect(splitCheck(100, "equal", [{}]).valid).toBe(true);
  expect(splitCheck(100, "equal", []).valid).toBe(false);
});
