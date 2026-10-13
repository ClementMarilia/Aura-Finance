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

// Order confirmation e-mail saved as PDF.
const EMAIL = `
Livraria Online
Obrigado pela sua compra!
Pedido nº 4471-2291
Realizado em 21 de setembro de 2026
O Pequeno Príncipe          1   39,90
Frete                           12,50
Subtotal                        52,40
Desconto                        -5,00
Total do pedido          R$ 47,40
Pago com cartão de crédito final 1234
`;

test("reads an order confirmation e-mail with a textual date", () => {
  expect(parseReceiptText(EMAIL, TODAY)).toEqual({
    total: 47.4,
    date: "2026-09-21",
    merchant: "Livraria Online",
  });
});

test("understands month names in pt, it, es and en", () => {
  expect(findDate(["Data: 3 settembre 2026"], TODAY)).toBe("2026-09-03");
  expect(findDate(["Fecha: 14 de agosto de 2026"], TODAY)).toBe("2026-08-14");
  expect(findDate(["Order placed September 2, 2026"], TODAY)).toBe("2026-09-02");
  expect(findDate(["Tuesday 1st Sept. 2026"], TODAY)).toBe("2026-09-01");
  expect(findDate(["28 mar 2026"], TODAY)).toBe("2026-03-28");
  expect(findDate(["Total 12 items 2026"], TODAY)).toBeNull();
});

test("e-mail total keywords beat the generic 'total' of item counts", () => {
  expect(findTotal(["Total items 3", "Order total: €12,90", "Amount charged 12,90 EUR"])).toBe(12.9);
  expect(findTotal(["Totale ordine € 23,40"])).toBe(23.4);
});

// Real Italian receipt photographed on a table (OCR output after adaptive
// thresholding): junk from the table edge above the header, table headers
// ("DESCRIZIONE IVA PREZZO") that must never be taken as the store.
const REAL_KEBAP = `
sSSs———————————-—-—-—-—---ss———-.————sssd  sgs dc.
Led
em ss
1STANBUL cITY KEBAP SNC           |     +
VIA DANTE ALIGHIERI, 7
31027 SPRESIANO (TV)                  A”
PARTITA IVA 05046050265                 ax
DOCUMENTO COMMERCIALE
di vendita o prestazione              |
DESCRIZIONE       TVA PREZZO(€)
VR-PANINI        10%     6,50
BIBITE LATTINA    10%     2.00
TOTALE COMPLESSIVO         8,50
di cui IVA                0,77
PAGAMENTO ELETTRONICO      8,50    :
TIMPORTO PAGATO            8,50    ;
L      03/08/2026 13:10         :
DOCUMENTO N. 0244-0008           ,
Data 03/08/26 Ora 13:10      : |
IMPORTO EUR        8,50        :
ARRIVEDERCI E GRAZIE         |
`;

test("real photographed scontrino: skips edge junk and table headers", () => {
  expect(parseReceiptText(REAL_KEBAP, TODAY)).toEqual({
    total: 8.5,
    date: "2026-08-03",
    merchant: "Istanbul City Kebap Snc",
  });
});

test("without a readable store line, a table header is still not the merchant", () => {
  expect(findMerchant(["Y.", "em ss", "DESCRIZIONE      IVA PREZZO(€)", "VR-PANINI 10% 6,50"])).toBeNull();
});

test("merchant noise matches whole words only", () => {
  expect(findMerchant(["TELEPIZZA ROMA NORD", "Tel. 06 123456"])).toBe("Telepizza Roma Nord");
});
