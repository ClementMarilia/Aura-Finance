import { hasUsefulText, itemsToLines } from "@/lib/pdfReceipt";

const run = (str, x, y, width = str.length * 5, height = 10) => ({
  str, width, height, transform: [height, 0, 0, height, x, y],
});

test("groups runs by baseline, top to bottom, left to right", () => {
  const items = [
    run("60,38", 400, 300.6),          // same line as the label, slightly off baseline
    run("VALOR A PAGAR R$", 20, 300),
    run("MERCADO BOM PRECO", 20, 700),
    run("Emissão: 25/09/2026", 20, 120),
  ];

  expect(itemsToLines(items)).toEqual([
    "MERCADO BOM PRECO",
    "VALOR A PAGAR R$   60,38",
    "Emissão: 25/09/2026",
  ]);
});

test("joins adjacent runs of one word without inventing spaces", () => {
  // "Tot"+"ale" touch (kerning split); "8,86" starts a normal word space later.
  const items = [run("Tot", 20, 100, 15), run("ale", 35, 100, 15), run("8,86", 53, 100, 20)];

  expect(itemsToLines(items)).toEqual(["Totale 8,86"]);
});

test("ignores empty runs", () => {
  expect(itemsToLines([run("  ", 0, 0), run("", 5, 5), { str: null }])).toEqual([]);
});

test("detects PDFs without a usable text layer", () => {
  expect(hasUsefulText(["", " - ", "1"])).toBe(false);
  expect(hasUsefulText(["Pedido 123 Total 12,90 EUR"])).toBe(true);
});
