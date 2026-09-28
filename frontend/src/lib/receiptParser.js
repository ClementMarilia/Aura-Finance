// Turns noisy OCR text from a paper receipt into { total, date, merchant }.
// Every field may be null: the user always reviews before saving.

const TOTAL_KEYWORDS = [
  // pt
  "valor a pagar", "valor total", "total a pagar", "total r$", "total geral", "valor pago",
  // it
  "totale complessivo", "importo pagato", "totale eur", "totale euro", "totale",
  // es
  "total a pagar", "importe total", "total eur", "total €",
  // en
  "amount due", "grand total", "total due", "balance due",
  // generic, lowest priority
  "total",
];

// Lines that mention a total-like word but are not the amount paid.
const NOT_TOTAL = [
  "subtotal", "sub total", "sub-total", "total de itens", "total itens", "qtd", "quantidade",
  "tributos", "impostos", "lei 12.741", "iva", "imposta", "iva incl", "desconto", "sconto",
  "descuento", "discount", "tax", "troco", "resto", "cambio", "change", "pezzi", "articoli",
  "items", "economia", "poupou",
];

// Money handed over or returned: bigger than the total, never the total.
const TENDERED = [
  "dinheiro", "troco", "valor recebido", "recebido", "contanti", "resto", "efectivo",
  "cambio", "cash", "change", "entregue", "pago em",
];

const MERCHANT_NOISE = [
  "cnpj", "cpf", "ie:", "i.e.", "im:", "p.iva", "p. iva", "partita iva", "c.f.", "cif", "nif",
  "cupom", "cupon", "documento", "scontrino", "ricevuta", "factura", "ticket", "nfc-e", "nf-e",
  "extrato", "sat n", "tel", "fone", "www", "http", "rua ", "av.", "avenida", "via ", "calle",
  "cep", "cap ", "data", "hora", "caixa", "operador", "cassa", "bem-vindo", "benvenuti",
  "bienvenido", "welcome", "obrigado", "grazie", "gracias",
];

export function normalizeLine(line) {
  return String(line || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// OCR often reads 0 as O/o, 1 as l/I and 5 as S inside numbers.
function fixDigits(text) {
  return text.replace(/(?<=[\d.,])[Oo](?=[\d.,Oo]|\b)|(?<=\b)[Oo](?=[.,]\d)/g, "0")
    .replace(/(?<=\d)[lI](?=\d)/g, "1")
    .replace(/(?<=\d[.,]?)S(?=\d)/g, "5");
}

const MONEY = /(?<![\d.,])(\d{1,3}(?:[.,]\d{3})+|\d+)\s?[.,]\s?(\d{2})(?![\d])/g;

export function moneyValues(line) {
  const values = [];
  for (const match of fixDigits(line).matchAll(MONEY)) {
    const integer = match[1].replace(/[.,]/g, "");
    const value = Number(`${integer}.${match[2]}`);
    if (Number.isFinite(value) && value > 0 && value < 1_000_000) values.push(value);
  }
  return values;
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

export function findTotal(lines) {
  const normalized = lines.map(normalizeLine);
  for (const keyword of TOTAL_KEYWORDS) {
    for (let index = normalized.length - 1; index >= 0; index -= 1) {
      const line = normalized[index];
      if (!line.includes(keyword) || includesAny(line, NOT_TOTAL)) continue;
      const own = moneyValues(lines[index]);
      if (own.length) return own[own.length - 1];
      const next = lines[index + 1] ? moneyValues(lines[index + 1]) : [];
      if (next.length) return next[next.length - 1];
    }
  }
  // No keyword survived OCR: the largest line amount that isn't cash handed
  // over. Only the last value of each line counts, so a unit price such as
  // "0,310 x 49,90   15,47" can't pass for the total.
  const candidates = lines
    .filter((line) => !includesAny(normalizeLine(line), [...TENDERED, ...NOT_TOTAL]))
    .map((line) => moneyValues(line).pop())
    .filter((value) => value !== undefined);
  return candidates.length ? Math.max(...candidates) : null;
}

const DATE_PATTERNS = [
  /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/, // ISO first: unambiguous
  /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/,
];

function toIso(year, month, day) {
  const fullYear = year < 100 ? 2000 + year : year;
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (date.getUTCFullYear() !== fullYear || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function findDate(lines, today = new Date()) {
  const todayIso = today.toISOString().slice(0, 10);
  const oldest = new Date(today);
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 2);
  const oldestIso = oldest.toISOString().slice(0, 10);

  for (const raw of lines) {
    const line = fixDigits(raw);
    const iso = line.match(DATE_PATTERNS[0]);
    const dmy = line.match(DATE_PATTERNS[1]);
    const candidates = [];
    if (iso) candidates.push(toIso(+iso[1], +iso[2], +iso[3]));
    if (dmy) {
      // Receipts in pt/it/es are day-first; fall back to month-first only
      // when day-first is impossible (e.g. 03/25/2026).
      candidates.push(toIso(+dmy[3], +dmy[2], +dmy[1]) || toIso(+dmy[3], +dmy[1], +dmy[2]));
    }
    const valid = candidates.find((value) => value && value <= todayIso && value >= oldestIso);
    if (valid) return valid;
  }
  return null;
}

function titleCase(text) {
  return text.toLowerCase().replace(/(^|[\s&/-])(\p{L})/gu, (_, sep, letter) => sep + letter.toUpperCase());
}

export function findMerchant(lines) {
  for (const raw of lines.slice(0, 8)) {
    const line = raw.replace(/[^\p{L}\d&.'\- ]/gu, " ").replace(/\s+/g, " ").trim();
    const letters = (line.match(/\p{L}/gu) || []).length;
    if (letters < 3 || letters / line.length < 0.6) continue;
    if (includesAny(normalizeLine(line), MERCHANT_NOISE)) continue;
    return titleCase(line).slice(0, 60);
  }
  return null;
}

export function parseReceiptText(text, today = new Date()) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    total: findTotal(lines),
    date: findDate(lines, today),
    merchant: findMerchant(lines),
  };
}

// Tesseract language model for the interface language.
export function ocrLanguage(uiLanguage) {
  return { pt: "por", it: "ita", es: "spa", en: "eng" }[uiLanguage] || "por";
}
