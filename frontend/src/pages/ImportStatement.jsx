import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BookmarkPlus, FileUp, Trash2, Upload } from "lucide-react";
import api, { fmtDate, fmtMoney, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  MAX_STATEMENT_BYTES,
  applyRuleToRows,
  categoryFitsType,
  commitPayload,
  decodeStatementBytes,
  initialSelection,
} from "@/lib/statementImport";
import { translate as tr } from "@/i18n";

const FIELD = "bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm";
const CELL_SELECT = "bg-white border border-[#E5E4E0] rounded-lg px-2 py-1 text-sm max-w-[11rem]";
const STATUS_BADGE = {
  new: { label: tr("Novo"), className: "bg-emerald-50 text-emerald-700" },
  possible_duplicate: { label: tr("Possível duplicado"), className: "bg-amber-50 text-amber-700" },
  imported: { label: tr("Já importado"), className: "bg-slate-100 text-slate-600" },
};
const SUMMARY_LABEL = {
  new: (count) => tr("{count} novo(s)", { count }),
  possible_duplicate: (count) => tr("{count} possível(is) duplicado(s)", { count }),
  imported: (count) => tr("{count} já importado(s)", { count }),
};
const SOURCE_LABEL = { rule: tr("Regra"), history: tr("Histórico") };
const MAPPING_FIELDS = [
  ["date", tr("Data")],
  ["description", tr("Descrição")],
  ["amount", tr("Valor")],
  ["debit", tr("Débito (saídas)")],
  ["credit", tr("Crédito (entradas)")],
];

export default function ImportStatement() {
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [rules, setRules] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [headers, setHeaders] = useState(null);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [ruleDraft, setRuleDraft] = useState(null);
  const [savingRule, setSavingRule] = useState(false);

  useEffect(() => {
    api.get("/accounts").then((r) => {
      setAccounts(r.data);
      if (r.data.length) setAccountId((current) => current || r.data[0].id);
    }).catch(() => {});
    api.get("/categories").then((r) => setCategories(r.data)).catch(() => {});
    api.get("/statement-imports/rules").then((r) => setRules(r.data)).catch(() => {});
  }, []);

  const categoryName = useMemo(
    () => Object.fromEntries(categories.map((item) => [item.id, item.name])),
    [categories],
  );
  const account = accounts.find((item) => item.id === accountId);
  const currency = preview?.account_currency || account?.currency || "EUR";

  const reset = () => {
    setPreview(null);
    setRows([]);
    setSelected(new Set());
    setHeaders(null);
    setMapping({});
  };

  const readFile = async (event) => {
    const chosen = event.target.files?.[0];
    reset();
    setFile(chosen || null);
    setContent("");
    if (!chosen) return;
    if (chosen.size > MAX_STATEMENT_BYTES) {
      toast.error(tr("Arquivo muito grande. O limite é 2 MB."));
      return;
    }
    setContent(decodeStatementBytes(await chosen.arrayBuffer()));
  };

  const loadPreview = async (columnMapping = null) => {
    if (!accountId) return toast.error(tr("Escolha a carteira do extrato"));
    if (!content) return toast.error(tr("Escolha um arquivo OFX ou CSV"));
    setLoading(true);
    try {
      const { data } = await api.post("/statement-imports/preview", {
        account_id: accountId,
        filename: file?.name || "",
        content,
        mapping: columnMapping,
      });
      setHeaders(null);
      setPreview(data);
      setRows(data.rows);
      setSelected(initialSelection(data.rows));
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (detail?.code === "mapping_required") {
        reset();
        setHeaders(detail.headers);
        toast.info(tr("Indique quais colunas do arquivo correspondem a cada campo."));
      } else {
        toast.error(formatApiError(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (rowId, changes) => {
    setRows((current) => current.map((row) => {
      if (row.row_id !== rowId) return row;
      const next = { ...row, ...changes };
      const category = categories.find((item) => item.id === next.category_id);
      if (next.category_id && !categoryFitsType(category, next.type)) next.category_id = null;
      return next;
    }));
  };

  const toggle = (rowId) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  };

  const selectable = rows.filter((row) => row.status !== "imported");
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.row_id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((row) => row.row_id)));
  const selectedCount = selectable.filter((row) => selected.has(row.row_id)).length;

  const undo = async (batchId) => {
    try {
      const { data } = await api.delete(`/statement-imports/batches/${batchId}`);
      toast.success(tr("{count} lançamento(s) removido(s)", { count: data.deleted }));
      if (content) loadPreview();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const commit = async () => {
    const payload = commitPayload(accountId, rows, selected);
    if (!payload.rows.length) return toast.error(tr("Selecione pelo menos um lançamento"));
    setCommitting(true);
    try {
      const { data } = await api.post("/statement-imports/commit", payload);
      toast.success(tr("{count} lançamento(s) importado(s)", { count: data.imported }), {
        action: data.batch_id ? { label: tr("Desfazer"), onClick: () => undo(data.batch_id) } : undefined,
        duration: 10000,
      });
      await loadPreview();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setCommitting(false);
    }
  };

  const saveRule = async (event) => {
    event.preventDefault();
    if (!ruleDraft.category_id) return toast.error(tr("Escolha uma categoria"));
    setSavingRule(true);
    try {
      const { data } = await api.post("/statement-imports/rules", {
        pattern: ruleDraft.pattern,
        category_id: ruleDraft.category_id,
        type: ruleDraft.type || null,
      });
      setRules((current) => [...current.filter((item) => item.id !== data.id), data]);
      setRows((current) => applyRuleToRows(current, data, categories));
      toast.success(tr("Regra salva"));
      setRuleDraft(null);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSavingRule(false);
    }
  };

  const deleteRule = async (ruleId) => {
    try {
      await api.delete(`/statement-imports/rules/${ruleId}`);
      setRules((current) => current.filter((item) => item.id !== ruleId));
      toast.success(tr("Regra excluída"));
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const summary = preview?.summary || {};

  return (
    <div className="space-y-6" data-testid="import-statement-page">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Importar extrato")}</h1>
        <p className="text-[#6B7068]">{tr("Traga os lançamentos do seu banco a partir de um arquivo OFX ou CSV.")}</p>
      </div>

      <div className="card-soft space-y-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] md:items-end">
          <div>
            <Label htmlFor="import-account">{tr("Carteira")}</Label>
            <select id="import-account" value={accountId} data-testid="import-account"
              onChange={(e) => { setAccountId(e.target.value); reset(); }} className={`${FIELD} w-full mt-1`}>
              {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="import-file">{tr("Arquivo do banco")}</Label>
            <Input id="import-file" type="file" accept=".ofx,.qfx,.csv,.txt" onChange={readFile}
              data-testid="import-file" className="mt-1 rounded-xl" />
          </div>
          <Button onClick={() => loadPreview()} disabled={loading || !content} data-testid="import-read"
            className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
            <FileUp size={16} className="mr-1" /> {loading ? tr("Lendo...") : tr("Ler arquivo")}
          </Button>
        </div>
        <p className="text-xs text-[#6B7068]">
          {tr("No site ou app do seu banco, procure por \"exportar extrato\" e escolha OFX (recomendado) ou CSV. O arquivo é lido apenas para montar a prévia; nada é salvo até você confirmar.")}
        </p>
      </div>

      {headers && (
        <div className="card-soft space-y-4" data-testid="import-mapping">
          <div>
            <h2 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>{tr("Colunas do arquivo")}</h2>
            <p className="text-sm text-[#6B7068]">{tr("Informe Data, Descrição e Valor. Se o banco separa saídas e entradas, use Débito e Crédito em vez de Valor.")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {MAPPING_FIELDS.map(([field, label]) => (
              <div key={field}>
                <Label htmlFor={`map-${field}`}>{label}</Label>
                <select id={`map-${field}`} value={mapping[field] || ""} className={`${FIELD} w-full mt-1`}
                  onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || null })}>
                  <option value="">—</option>
                  {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </div>
            ))}
          </div>
          <Button onClick={() => loadPreview(mapping)} disabled={loading} className="rounded-xl">
            {tr("Aplicar colunas")}
          </Button>
        </div>
      )}

      {preview && (
        <div className="card-soft space-y-4" data-testid="import-preview">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>{tr("Revisar lançamentos")}</h2>
              <div className="flex flex-wrap gap-2 mt-2 text-xs">
                {Object.entries(STATUS_BADGE).map(([status, badge]) => (
                  summary[status] ? (
                    <span key={status} className={`pill px-2 py-0.5 rounded-full ${badge.className}`}>
                      {SUMMARY_LABEL[status](summary[status])}
                    </span>
                  ) : null
                ))}
              </div>
            </div>
            {selectable.length > 0 ? (
              <Button onClick={commit} disabled={committing || !selectedCount} data-testid="import-commit"
                className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
                <Upload size={16} className="mr-1" />
                {committing ? tr("Importando...") : tr("Importar {count} lançamento(s)", { count: selectedCount })}
              </Button>
            ) : (
              <Button asChild variant="outline" className="rounded-xl" data-testid="import-done">
                <Link to="/lancamentos">{tr("Ver lançamentos →")}</Link>
              </Button>
            )}
          </div>

          {preview.currency_mismatch && (
            <div className="text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">
              {tr("O extrato está em {statement}, mas a carteira usa {account}. Confira se escolheu a carteira certa.", {
                statement: preview.statement_currency, account: preview.account_currency,
              })}
            </div>
          )}
          {summary.possible_duplicate > 0 && (
            <div className="text-sm text-[#6B7068]">
              {tr("\"Possível duplicado\" significa que já existe um lançamento com a mesma data, tipo e valor nesta carteira. Essas linhas começam desmarcadas.")}
            </div>
          )}

          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-[#6B7068] border-b border-[#E5E4E0]">
                  <th className="py-2 pr-2 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={tr("Selecionar todos")} />
                  </th>
                  <th className="py-2 pr-3">{tr("Data")}</th>
                  <th className="py-2 pr-3">{tr("Descrição")}</th>
                  <th className="py-2 pr-3">{tr("Tipo")}</th>
                  <th className="py-2 pr-3 text-right">{tr("Valor")}</th>
                  <th className="py-2 pr-3">{tr("Categoria")}</th>
                  <th className="py-2 pr-3">{tr("Situação")}</th>
                  <th className="py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const imported = row.status === "imported";
                  const badge = STATUS_BADGE[row.status];
                  return (
                    <tr key={row.row_id} className={`border-b border-[#E5E4E0] last:border-0 ${imported ? "opacity-50" : ""}`}>
                      <td className="py-2 pr-2">
                        <input type="checkbox" disabled={imported} checked={!imported && selected.has(row.row_id)}
                          onChange={() => toggle(row.row_id)} aria-label={row.description} />
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(`${row.date}T12:00:00`)}</td>
                      <td className="py-2 pr-3 max-w-[18rem] truncate" title={row.description}>{row.description}</td>
                      <td className="py-2 pr-3">
                        <select value={row.type} disabled={imported} className={CELL_SELECT}
                          onChange={(e) => updateRow(row.row_id, { type: e.target.value })}>
                          <option value="expense">{tr("Despesa")}</option>
                          <option value="income">{tr("Receita")}</option>
                        </select>
                      </td>
                      <td className={`py-2 pr-3 text-right whitespace-nowrap money-value ${row.type === "income" ? "text-emerald-700" : ""}`}>
                        {row.type === "income" ? "+" : "−"}{fmtMoney(row.amount, currency)}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <select value={row.category_id || ""} disabled={imported} className={CELL_SELECT}
                            onChange={(e) => updateRow(row.row_id, { category_id: e.target.value || null, category_source: "manual" })}>
                            <option value="">{tr("Sem categoria")}</option>
                            {categories.filter((item) => categoryFitsType(item, row.type)).map((item) => (
                              <option key={item.id} value={item.id}>{item.name}</option>
                            ))}
                          </select>
                          {SOURCE_LABEL[row.category_source] && (
                            <span className="text-[11px] text-[#6B7068] whitespace-nowrap">{SOURCE_LABEL[row.category_source]}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`pill text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${badge.className}`}>{badge.label}</span>
                      </td>
                      <td className="py-2">
                        {!imported && (
                          <button type="button" title={tr("Criar regra a partir desta linha")}
                            aria-label={tr("Criar regra a partir desta linha")}
                            className="p-1 rounded-md text-[#6B7068] hover:text-[#061B4A]"
                            onClick={() => setRuleDraft({ pattern: row.description, category_id: row.category_id || "", type: row.type })}>
                            <BookmarkPlus size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card-soft space-y-3" data-testid="import-rules">
        <div>
          <h2 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>{tr("Regras de categoria")}</h2>
          <p className="text-sm text-[#6B7068]">
            {tr("Quando a descrição contém o texto da regra, a categoria é preenchida automaticamente. Sem regra, o app sugere a categoria que você usou antes para descrições parecidas.")}
          </p>
        </div>
        {rules.length === 0 ? (
          <p className="text-sm text-[#6B7068]">{tr("Nenhuma regra ainda. Use o ícone ao lado de uma linha da prévia para criar a primeira.")}</p>
        ) : (
          <ul className="divide-y divide-[#E5E4E0]">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium">“{rule.pattern}”</span>
                  {" → "}{categoryName[rule.category_id] || tr("Categoria removida")}
                  {rule.type && <span className="text-[#6B7068]"> · {rule.type === "income" ? tr("Receita") : tr("Despesa")}</span>}
                </span>
                <button type="button" onClick={() => deleteRule(rule.id)} aria-label={tr("Excluir regra")}
                  className="p-1 rounded-md text-[#6B7068] hover:text-red-600">
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm">
          <Link to="/lancamentos" className="underline text-[#061B4A]">{tr("Ver lançamentos →")}</Link>
        </p>
      </div>

      <Dialog open={!!ruleDraft} onOpenChange={(open) => { if (!open) setRuleDraft(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{tr("Nova regra de categoria")}</DialogTitle></DialogHeader>
          {ruleDraft && (
            <form onSubmit={saveRule} className="space-y-3">
              <div>
                <Label htmlFor="rule-pattern">{tr("Quando a descrição contém")}</Label>
                <Input id="rule-pattern" value={ruleDraft.pattern} maxLength={100} className="mt-1"
                  onChange={(e) => setRuleDraft({ ...ruleDraft, pattern: e.target.value })} />
                <p className="text-xs text-[#6B7068] mt-1">{tr("Deixe só a parte que se repete, por exemplo \"LIDL\" ou \"UBER\". Números e datas variam a cada mês.")}</p>
              </div>
              <div>
                <Label htmlFor="rule-category">{tr("Usar a categoria")}</Label>
                <select id="rule-category" value={ruleDraft.category_id} className={`${FIELD} w-full mt-1`}
                  onChange={(e) => setRuleDraft({ ...ruleDraft, category_id: e.target.value })}>
                  <option value="">—</option>
                  {categories.filter((item) => categoryFitsType(item, ruleDraft.type)).map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setRuleDraft(null)}>{tr("Cancelar")}</Button>
                <Button type="submit" disabled={savingRule} className="bg-[#061B4A] hover:bg-[#1268F4]">
                  {savingRule ? tr("Salvando...") : tr("Salvar regra")}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
