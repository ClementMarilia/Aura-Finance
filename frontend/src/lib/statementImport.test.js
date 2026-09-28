import { TextDecoder as NodeTextDecoder } from "util";
import {
  applyRuleToRows,
  commitPayload,
  decodeStatementBytes,
  initialSelection,
  normalizeText,
} from "@/lib/statementImport";

if (typeof global.TextDecoder === "undefined") global.TextDecoder = NodeTextDecoder;

const categories = [
  { id: "food", kind: "expense" },
  { id: "salary", kind: "income" },
  { id: "misc", kind: "both" },
];

const rows = [
  { row_id: "a", date: "2026-09-01", description: "LIDL SUPERMERCADO", amount: 10, type: "expense", category_id: null, category_source: null, status: "new" },
  { row_id: "b", date: "2026-09-02", description: "Lidl online", amount: 5, type: "expense", category_id: "misc", category_source: "manual", status: "new" },
  { row_id: "c", date: "2026-09-03", description: "Lidl reembolso", amount: 5, type: "income", category_id: null, category_source: null, status: "possible_duplicate" },
  { row_id: "d", date: "2026-09-04", description: "Salário", amount: 900, type: "income", category_id: null, category_source: null, status: "imported" },
];

test("decodes UTF-8 and falls back to Windows-1252", () => {
  expect(decodeStatementBytes(new Uint8Array([0x53, 0x61, 0x6c, 0xc3, 0xa1]))).toBe("Salá");
  expect(decodeStatementBytes(new Uint8Array([0x53, 0x61, 0x6c, 0xe1]))).toBe("Salá");
});

test("normalizes accents, case and spaces", () => {
  expect(normalizeText("  Café   CENTRAL ")).toBe("cafe central");
});

test("selects only new rows by default", () => {
  expect([...initialSelection(rows)]).toEqual(["a", "b"]);
});

test("a rule fills matching rows without overriding manual or incompatible choices", () => {
  const updated = applyRuleToRows(rows, { pattern: "lidl", category_id: "food", type: null }, categories);

  expect(updated[0]).toMatchObject({ category_id: "food", category_source: "rule" });
  expect(updated[1]).toMatchObject({ category_id: "misc", category_source: "manual" });
  expect(updated[2].category_id).toBeNull();
});

test("commit payload skips unselected and already imported rows", () => {
  const payload = commitPayload("acc", rows, new Set(["a", "d"]));

  expect(payload).toEqual({
    account_id: "acc",
    rows: [{ row_id: "a", date: "2026-09-01", description: "LIDL SUPERMERCADO", amount: 10, type: "expense", category_id: null }],
  });
});
