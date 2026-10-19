import { parseAmount, parseVoiceEntry } from "./voiceEntry";

test("reads Brazilian and plain amounts", () => {
  expect(parseAmount("35")).toBe(35);
  expect(parseAmount("35,50")).toBe(35.5);
  expect(parseAmount("1.200,50")).toBe(1200.5);
  expect(parseAmount("1.200")).toBe(1200);
  expect(parseAmount("12.5")).toBe(12.5);
  expect(parseAmount("0")).toBeNull();
});

test("expense sentence gives amount and description", () => {
  expect(parseVoiceEntry("gastei 35 reais no mercado")).toEqual({
    amount: 35, type: "expense", description: "Mercado",
  });
  expect(parseVoiceEntry("paguei R$ 120,90 de luz")).toEqual({
    amount: 120.9, type: "expense", description: "Luz",
  });
});

test("income words switch the type", () => {
  expect(parseVoiceEntry("recebi 1.200 de salário")).toMatchObject({ amount: 1200, type: "income" });
  expect(parseVoiceEntry("I spent 12.5 on coffee")).toMatchObject({ amount: 12.5, type: "expense" });
});

test("no number gives no amount", () => {
  expect(parseVoiceEntry("comprei pão")).toMatchObject({ amount: null, description: "Pão" });
  expect(parseVoiceEntry("")).toEqual({ amount: null, type: "expense", description: "" });
});
