// Turns a dictated sentence ("gastei 35 reais no mercado") into the fields of
// a new transaction. Speech engines return digits, so only numerals are read.
const NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/;
const CURRENCY = /(?:r\$|€|\$)\s*|\s*(?:reais|real|euros?|eur|d[oó]lares?|dollars?|dolares?|brl|usd)\b/gi;
const INCOME = /\b(recebi|ganhei|recebimento|sal[aá]rio|entrou|received|earned|income|salary|recib[ií]|gan[eé]|ingreso|ricevuto|stipendio|guadagnato)\b/i;
const VERB = /^(?:gastei|paguei|comprei|recebi|ganhei|i\s+spent|i\s+paid|i\s+bought|i\s+received|i\s+earned|gast[eé]|pagu[eé]|compr[eé]|recib[ií]|gan[eé]|ho\s+speso|ho\s+pagato|ho\s+comprato|ho\s+ricevuto)\s+/i;
const CONNECTOR = /^(?:de|do|da|no|na|em|com|pra|para|in|on|at|for|of|en|el|la|a|per|di|il|al)\s+/i;

export function parseAmount(token) {
  if (!token) return null;
  let value = token;
  if (value.includes(".") && value.includes(",")) value = value.replace(/\./g, "").replace(",", ".");
  else if (value.includes(",")) value = value.replace(",", ".");
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) value = value.replace(/\./g, "");
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseVoiceEntry(text) {
  const spoken = String(text || "").trim();
  const match = spoken.replace(CURRENCY, " ").match(NUMBER);
  const amount = parseAmount(match?.[0]);
  let description = spoken.replace(CURRENCY, " ");
  if (match) description = description.replace(match[0], " ");
  description = description.replace(/\s+/g, " ").trim().replace(VERB, "");
  while (CONNECTOR.test(description)) description = description.replace(CONNECTOR, "");
  description = description.trim();
  return {
    amount,
    type: INCOME.test(spoken) ? "income" : "expense",
    description: description ? description[0].toUpperCase() + description.slice(1) : "",
  };
}
