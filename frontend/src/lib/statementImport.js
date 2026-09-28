export const MAX_STATEMENT_BYTES = 2 * 1024 * 1024;

// Banks still export many CSV/OFX files as Windows-1252; decoding them as
// UTF-8 would turn "Salário" into "Sal�rio".
export function decodeStatementBytes(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Only rows that are new start selected: already-imported rows can't be
// imported again, and possible duplicates need an explicit decision.
export function initialSelection(rows) {
  return new Set(rows.filter((row) => row.status === "new").map((row) => row.row_id));
}

export function categoryFitsType(category, type) {
  const kind = category?.kind || "expense";
  return kind === "both" || kind === type;
}

// After a rule is created, apply it to the rows still on screen whose
// category the user did not pick by hand.
export function applyRuleToRows(rows, rule, categories) {
  const pattern = normalizeText(rule.pattern);
  const category = categories.find((item) => item.id === rule.category_id);
  return rows.map((row) => {
    if (row.category_source === "manual") return row;
    if (rule.type && rule.type !== row.type) return row;
    if (!category || !categoryFitsType(category, row.type)) return row;
    if (!normalizeText(row.description).includes(pattern)) return row;
    return { ...row, category_id: rule.category_id, category_source: "rule" };
  });
}

export function commitPayload(accountId, rows, selected) {
  return {
    account_id: accountId,
    rows: rows
      .filter((row) => selected.has(row.row_id) && row.status !== "imported")
      .map(({ row_id, date, description, amount, type, category_id }) => ({
        row_id, date, description, amount, type, category_id: category_id || null,
      })),
  };
}
