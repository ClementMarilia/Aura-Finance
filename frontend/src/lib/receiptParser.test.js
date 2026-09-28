import {
  findDate,
  findMerchant,
  findTotal,
  moneyValues,
  ocrLanguage,
  parseReceiptText,
} from "@/lib/receiptParser";

const TODAY = new Date("2026-09-28T12:00:00Z");

// Typical Brazilian NFC-e as read by OCR (noise, "O" instead of "0").
const BR = `
SUPERMERCADOS BOA COMPRA LTDA
CNPJ: 12.345.678/0001-90 IE: 123456789
RUA DAS FLORES, 100 - CENTRO
Documento Auxiliar da Nota Fiscal de Consumidor Eletronica
001 ARROZ TIPO 1 5KG     1 UN x 24,90   24,90
002 FEIJAO PRETO 1KG     2 UN x 8,49    16,98
003 CAFE 500G            1 UN x 18,5O   18,50
QTD. TOTAL DE ITENS                        4
VALOR TOTAL R$                          60,38
Desconto R$                              0,00
VALOR A PAGAR R$                        60,38
FORMA PAGAMENTO           VALOR PAGO R$
Dinheiro                                100,00
Troco R$                                 39,62
Tributos Totais Incidentes (Lei 12.741) 12,15
EMISSAO: 25/09/2026 18:42:10
`;

// Italian "scontrino" with the total on its own label line.
const IT = `
CONAD CITY
Via Roma 12 - 20121 Milano
P.IVA 01234567890
DOCUMENTO COMMERCIALE di vendita o prestazione
LATTE INTERO 1L           1,29
PANE COMUNE               2,10
MOZZARELLA                3,45
TOTALE COMPLESSIVO
                          6,84
di cui IVA                0,62
PAGAMENTO CONTANTE       10,00
RESTO                     3,16
27-09-2026 10:15
`;

// Spanish ticket without any readable total keyword.
const ES = `
Panaderia La Espiga
NIF B12345678
BARRA PAN 0,95
CROISSANT 1,40
CAFE CON LECHE 1,60
TOTAL EUR 3,95
EFECTIVO 5,00
CAMBIO 1,05
26/09/26
`;

test("parses a Brazilian NFC-e: pays attention to 'valor a pagar', not cash given", () => {
  expect(parseReceiptText(BR, TODAY)).toEqual({
    total: 60.38,
    date: "2026-09-25",
    merchant: "Supermercados Boa Compra Ltda",
  });
});

test("parses an Italian scontrino with the total on the following line", () => {
  expect(parseReceiptText(IT, TODAY)).toEqual({ total: 6.84, date: "2026-09-27", merchant: "Conad City" });
});

test("parses a Spanish ticket with two-digit year", () => {
  expect(parseReceiptText(ES, TODAY)).toEqual({ total: 3.95, date: "2026-09-26", merchant: "Panaderia La Espiga" });
});

test("falls back to the largest amount that is not cash tendered", () => {
  const lines = ["LOJA X", "ITEM A 12,00", "ITEM B 30,50", "T0TAI 42,50", "DINHEIRO 50,00", "TROCO 7,50"];
  expect(findTotal(lines)).toBe(42.5);
});

test("fallback ignores unit prices in the middle of item lines", () => {
  const lines = ["PADARIA", "QUEIJO KG 0,310 x 49,90 15,47", "CAFE 1 x 21,90 21,90", "PAO 8,65"];
  expect(findTotal(lines)).toBe(21.9);
});

test("reads money with thousands separators and OCR letter noise", () => {
  expect(moneyValues("TOTAL R$ 1.234,56")).toEqual([1234.56]);
  expect(moneyValues("TOTAL 1,234.56")).toEqual([1234.56]);
  expect(moneyValues("CAFE 18,5O")).toEqual([18.5]);
  expect(moneyValues("TOTAL 12. 90")).toEqual([12.9]);
  expect(moneyValues("CNPJ 12.345.678/0001-90")).toEqual([]);
  // quantity followed by a price must not merge into one number
  expect(moneyValues("ITEM 1 250,00")).toEqual([250]);
});

test("ignores future dates, dates older than two years and impossible dates", () => {
  expect(findDate(["VALIDADE 10/10/2027", "31/02/2026", "EMITIDO 03/01/2020", "20/09/2026"], TODAY)).toBe("2026-09-20");
  expect(findDate(["2026-09-01 12:00"], TODAY)).toBe("2026-09-01");
  expect(findDate(["09/25/2026"], TODAY)).toBe("2026-09-25");
  expect(findDate(["sem data"], TODAY)).toBeNull();
});

test("skips header noise when looking for the merchant", () => {
  expect(findMerchant(["*** CUPOM FISCAL ***", "CNPJ 12.345.678/0001-90", "FARMACIA SAO JOAO"])).toBe("Farmacia Sao Joao");
  expect(findMerchant(["12345", "---"])).toBeNull();
});

test("maps interface language to OCR model", () => {
  expect(ocrLanguage("it")).toBe("ita");
  expect(ocrLanguage("xx")).toBe("por");
});
