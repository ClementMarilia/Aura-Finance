import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { CURRENCIES, fmtMoney, fmtDate, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Trash2, Pencil, FileDown, Paperclip, Eye, X, Repeat, CreditCard, Check, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { exportCSV } from "@/lib/exporters";

import { getMonthNames, translate as tr } from "@/i18n";
const STATUS_LABEL = { paid: tr("Pago"), pending: tr("Pendente"), cancelled: tr("Cancelado") };
const TYPE_LABEL = { income: tr("Receita"), expense: tr("Despesa"), transfer: tr("Transferência") };
const MONTHS = getMonthNames("short");
const PERIOD_KEY = "aura_period";
function readSavedPeriod() {
  try { return JSON.parse(localStorage.getItem(PERIOD_KEY)) || null; } catch { return null; }
}

export default function Transactions() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [accs, setAccs] = useState([]);
  const now = new Date();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState(() => {
    const saved = readSavedPeriod();
    const d = new Date();
    return {
      status: searchParams.get("status") || "",
      type: searchParams.get("type") || "",
      category_id: searchParams.get("category_id") || "",
      year: searchParams.get("year") || saved?.year || String(d.getFullYear()),
      month: searchParams.get("month") || saved?.month || String(d.getMonth() + 1),
      account_id: searchParams.get("account_id") || "",
    };
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(defaultForm());
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [uploadingId, setUploadingId] = useState(null);
  const fileInputRef = useRef(null);
  const pendingUploadTx = useRef(null);

  function defaultForm() {
    return {
      type: "expense",
      date: new Date().toISOString().slice(0, 10),
      amount: "",
      category_id: "",
      account_id: "",
      from_account_id: "",
      to_account_id: "",
      payment_method: "",
      description: "",
      notes: "",
      status: "paid",
      repeat: "none",
      currency: curr,
      exchange_rate: "",
      target_amount: "",
      rate_source: "automatic",
      rate_date: "",
      rate_estimated: false,
    };
  }

  const load = () => {
    const params = {};
    Object.entries(filter).forEach(([k, v]) => { if (v) params[k] = v; });
    api.get("/transactions", { params }).then(r => { setItems(r.data); setSelected([]); });
  };

  useEffect(() => {
    api.get("/categories").then(r => setCats(r.data));
    api.get("/accounts").then(r => setAccs(r.data));
  }, []);

  const sourceAccount = form.type === "transfer"
    ? accs.find(a => a.id === form.from_account_id)
    : accs.find(a => a.id === form.account_id);
  const targetAccount = form.type === "transfer"
    ? accs.find(a => a.id === form.to_account_id)
    : null;
  const sourceCurrency = sourceAccount?.currency || form.currency || curr;
  const targetCurrency = targetAccount?.currency || curr;
  const needsExchangeRate = sourceCurrency !== targetCurrency;
  const numericRate = Number(form.exchange_rate);
  const numericAmount = Number(form.amount);
  const convertedAmount = numericAmount > 0 && numericRate > 0
    ? numericAmount * numericRate
    : null;
  const rateContext = `${form.type}|${form.currency}|${form.account_id}|${form.from_account_id}|${form.to_account_id}|${form.date}`;
  const editingRateContext = editing
    ? `${editing.type}|${editing.currency || curr}|${editing.account_id || ""}|${editing.from_account_id || ""}|${editing.to_account_id || ""}|${editing.date}`
    : "";

  useEffect(() => {
    if (!open || (form.type === "transfer" && (!sourceAccount || !targetAccount))) return;
    if (editing && rateContext === editingRateContext) return;
    if (sourceCurrency === targetCurrency) {
      setRateLoading(false);
      setRateError("");
      setForm(previous => ({
        ...previous,
        exchange_rate: "1",
        target_amount: previous.type === "transfer" ? previous.amount : previous.target_amount,
        rate_source: "automatic",
        rate_date: previous.date,
        rate_estimated: false,
      }));
      return;
    }
    let active = true;
    setRateLoading(true);
    setRateError("");
    if (sourceCurrency !== targetCurrency) {
      setForm(previous => ({
        ...previous,
        exchange_rate: "",
        rate_date: "",
        rate_estimated: false,
      }));
    }
    api.get("/exchange-rates/quote", { params: {
      from_currency: sourceCurrency,
      to_currency: targetCurrency,
      date: form.date,
    }}).then(response => {
      if (!active) return;
      const rate = Number(response.data.rate);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(tr("A API não retornou uma cotação válida"));
      }
      setForm(previous => ({
        ...previous,
        exchange_rate: String(rate),
        target_amount: previous.type === "transfer" && previous.amount
          ? String((Number(previous.amount) * rate).toFixed(2))
          : previous.target_amount,
        rate_source: "automatic",
        rate_date: response.data.date || "",
        rate_estimated: Boolean(response.data.estimated),
      }));
    }).catch(err => {
      if (!active) return;
      const message = formatApiError(err);
      setRateError(message);
      toast.error(message);
    }).finally(() => {
      if (active) setRateLoading(false);
    });
    return () => { active = false; };
  }, [open, editing, form.type, form.account_id, form.from_account_id, form.to_account_id, form.date, sourceCurrency, targetCurrency, sourceAccount, targetAccount, rateContext, editingRateContext]);
  useEffect(() => { load(); }, [filter.status, filter.type, filter.category_id, filter.year, filter.month, filter.account_id]);

  // React to URL changes (when user navigates from another page like Dashboard)
  const sp = searchParams.toString();
  useEffect(() => {
    const saved = readSavedPeriod();
    const d = new Date();
    setFilter({
      status: searchParams.get("status") || "",
      type: searchParams.get("type") || "",
      category_id: searchParams.get("category_id") || "",
      year: searchParams.get("year") || saved?.year || String(d.getFullYear()),
      month: searchParams.get("month") || saved?.month || String(d.getMonth() + 1),
      account_id: searchParams.get("account_id") || "",
    });
  }, [sp]);

  // Persist last month/year selection so it is kept across navigation
  useEffect(() => {
    if (filter.year && filter.month) {
      try { localStorage.setItem(PERIOD_KEY, JSON.stringify({ year: filter.year, month: filter.month })); } catch (_) {}
    }
  }, [filter.year, filter.month]);

  const clearFilters = () => {
    setFilter({ status: "", type: "", category_id: "", year: "", month: "", account_id: "" });
    setSearchParams({}, { replace: true });
  };
  const hasActiveFilters = Object.values(filter).some(Boolean);

  const openEdit = (t) => {
    setEditing(t);
    setForm({
      type: t.type, date: t.date, amount: String(t.amount),
      category_id: t.category_id || "", account_id: t.account_id || "",
      from_account_id: t.from_account_id || "", to_account_id: t.to_account_id || "",
      payment_method: t.payment_method || "", description: t.description || "",
      notes: t.notes || "", status: t.status,
      currency: t.currency || curr,
      exchange_rate: String(t.type === "transfer" ? (t.transfer_exchange_rate || 1) : (t.exchange_rate_to_base || 1)),
      target_amount: String(t.target_amount ?? t.amount),
      rate_source: t.rate_source === "manual" ? "manual" : "automatic",
      rate_date: t.rate_date || "",
      rate_estimated: false,
    });
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setRateError("");
    setRateLoading(false);
    setForm(defaultForm());
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    const exchangeRate = needsExchangeRate ? Number(form.exchange_rate) : 1;
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(tr("Informe um valor maior que zero"));
      return;
    }
    if (rateLoading) {
      toast.error(tr("Aguarde a cotação automática"));
      return;
    }
    if (needsExchangeRate && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      toast.error(tr("Informe uma cotação válida antes de salvar"));
      return;
    }
    try {
      // Recurring payment created straight from Lançamentos
      if (!editing && form.repeat && form.repeat !== "none" && form.type !== "transfer") {
        await api.post("/recurrences", {
          type: form.type,
          amount: parseFloat(form.amount) || 0,
          category_id: form.category_id || null,
          account_id: form.account_id || null,
          payment_method: form.payment_method || null,
          description: form.description,
          currency: sourceCurrency,
          exchange_rate: exchangeRate,
          rate_source: form.rate_source,
          frequency: form.repeat,
          next_run: form.date,
          active: true,
        });
        toast.success(tr("Pagamento recorrente criado"));
        setOpen(false); setEditing(null); setForm(defaultForm()); load();
        return;
      }
      const body = {
        ...form,
        amount: parseFloat(form.amount),
        category_id: form.category_id || null,
        account_id: form.account_id || null,
        from_account_id: form.type === "transfer" ? (form.from_account_id || null) : null,
        to_account_id: form.type === "transfer" ? (form.to_account_id || null) : null,
        currency: sourceCurrency,
        exchange_rate: exchangeRate,
        target_amount: form.type === "transfer" ? (parseFloat(form.target_amount) || 0) : null,
        rate_source: form.rate_source,
      };
      if (editing) {
        await api.put(`/transactions/${editing.id}`, body);
        toast.success(tr("Lançamento atualizado"));
      } else {
        await api.post("/transactions", body);
        toast.success(tr("Lançamento criado"));
      }
      setOpen(false); setEditing(null); setForm(defaultForm()); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    await api.delete(`/transactions/${confirmDel.id}`);
    setConfirmDel(null);
    toast.success(tr("Lançamento excluído"));
    load();
  };

  const selectableIds = () => items.filter(t => t.editable !== false).map(t => t.id);
  const allSelected = selected.length > 0 && selected.length === selectableIds().length;
  const toggleSelect = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleSelectAll = () => setSelected(allSelected ? [] : selectableIds());
  const bulkDelete = async () => {
    try {
      const r = await api.post("/transactions/bulk-delete", { ids: selected });
      toast.success(tr("{count} lançamento(s) excluído(s)", { count: r.data?.deleted ?? selected.length }));
    } catch (err) { toast.error(formatApiError(err)); }
    setBulkConfirm(false);
    load();
  };

  const triggerUpload = (t) => { pendingUploadTx.current = t; fileInputRef.current?.click(); };

  const onFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const t = pendingUploadTx.current;
    if (!file || !t) return;
    const fd = new FormData();
    fd.append("file", file);
    setUploadingId(t.id);
    try {
      await api.post(`/transactions/${t.id}/receipt`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(tr("Comprovante anexado"));
      load();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setUploadingId(null); }
  };

  const viewReceipt = async (t) => {
    try {
      const r = await api.get(`/files/${t.receipt.path}`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { toast.error(tr("Erro ao abrir comprovante")); }
  };

  const removeReceipt = async (t) => {
    await api.delete(`/transactions/${t.id}/receipt`);
    toast.success(tr("Comprovante removido"));
    load();
  };

  const payInstallment = async (t) => {
    await api.post(`/installments/${t.id}/pay`);
    toast.success(t.status === "paid" ? "Parcela reaberta" : "Parcela paga");
    load();
  };

  const payTransaction = async (t) => {
    try {
      const r = await api.post(`/transactions/${t.id}/pay`);
      const ns = r.data?.status;
      toast.success(ns === "paid" ? tr("Pagamento confirmado") : tr("Lançamento marcado como pendente"));
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const handleCSV = () => {
    if (items.length === 0) { toast.error(tr("Nada para exportar")); return; }
    exportCSV(
      `lancamentos_${new Date().toISOString().slice(0, 10)}.csv`,
      [tr("Data"), tr("Descrição"), tr("Categoria"), tr("Tipo"), tr("Status"), "Valor original", tr("Moeda"), "Valor na moeda-base", tr("Moeda-base")],
      items.map(t => [
        t.date, t.description || "", cats.find(c => c.id === t.category_id)?.name || "",
        TYPE_LABEL[t.type], STATUS_LABEL[t.status], t.amount, t.currency || curr,
        t.type === "transfer" ? "" : (t.base_amount ?? t.amount), t.type === "transfer" ? "" : curr,
      ]),
    );
  };

  return (
    <div className="space-y-6" data-testid="transactions-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Lançamentos")}</h1>
          <p className="text-[#6B7068]">{tr("Receitas, despesas e transferências")}</p>
        </div>
        <div className="flex gap-2">
        <Button variant="outline" onClick={handleCSV} data-testid="tx-export-csv" className="rounded-xl">
          <FileDown size={16} className="mr-1" /> {tr("CSV")}
        </Button>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={openNew} data-testid="new-transaction-button" className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
              <Plus size={16} className="mr-1" /> {tr("Novo lançamento")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg" data-testid="new-transaction-dialog">
            <DialogHeader><DialogTitle>{editing ? tr("Editar lançamento") : tr("Novo lançamento")}</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{tr("Tipo")}</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="tx-type-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="income">{tr("Receita")}</SelectItem>
                      <SelectItem value="expense">{tr("Despesa")}</SelectItem>
                      <SelectItem value="transfer">{tr("Transferência")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tr("Status")}</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger data-testid="tx-status-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">{tr("Pago")}</SelectItem>
                      <SelectItem value="pending">{tr("Pendente")}</SelectItem>
                      <SelectItem value="cancelled">{tr("Cancelado")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tr("Data")}</Label>
                  <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required data-testid="tx-date-input" />
                </div>
                <div>
                  <Label>{tr("Valor")}</Label>
                  <Input type="number" step="0.01" value={form.amount}
                    onChange={e => {
                      const amount = e.target.value;
                      const target = form.type === "transfer" && amount && form.exchange_rate
                        ? (Number(amount) * Number(form.exchange_rate)).toFixed(2) : form.target_amount;
                      setForm({ ...form, amount, target_amount: target });
                    }} required data-testid="tx-amount-input" />
                </div>
                {form.type !== "transfer" && (
                <div>
                  <Label>{tr("Moeda")}</Label>
                  <Select value={sourceCurrency} onValueChange={(value) => {
                    const selectedAccount = accs.find(account => account.id === form.account_id);
                    setForm({
                      ...form,
                      currency: value,
                      account_id: selectedAccount && selectedAccount.currency !== value ? "" : form.account_id,
                      exchange_rate: "",
                      rate_source: "automatic",
                      rate_date: "",
                      rate_estimated: false,
                    });
                  }}>
                    <SelectTrigger data-testid="tx-currency-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(currency => (
                        <SelectItem key={currency.value} value={currency.value}>{currency.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                )}
                {form.type !== "transfer" && (
                <div>
                  <Label>{tr("Categoria")}</Label>
                  <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                    <SelectTrigger data-testid="tx-category-select"><SelectValue placeholder={tr("Selecione")} /></SelectTrigger>
                    <SelectContent>
                      {cats
                        .filter(c => {
                          const k = c.kind || "expense";
                          if (k === "both") return true;
                          return k === form.type;
                        })
                        .map(c => <SelectItem key={c.id} value={c.id}>{tr(c.name)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                )}
                {form.type !== "transfer" && (
                <div>
                  <Label>{tr("Conta")}</Label>
                  <Select value={form.account_id} onValueChange={(value) => {
                    const account = accs.find(item => item.id === value);
                    setForm({
                      ...form,
                      account_id: value,
                      currency: account?.currency || form.currency || curr,
                      exchange_rate: "",
                      rate_source: "automatic",
                      rate_date: "",
                      rate_estimated: false,
                    });
                  }}>
                    <SelectTrigger data-testid="tx-account-select"><SelectValue placeholder={tr("Selecione")} /></SelectTrigger>
                    <SelectContent>
                      {accs.map(a => <SelectItem key={a.id} value={a.id}>{tr(a.name)} ({a.currency || curr})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                )}
                {form.type === "transfer" && (
                <div>
                  <Label>{tr("De conta")}</Label>
                  <Select value={form.from_account_id} onValueChange={(v) => setForm({ ...form, from_account_id: v })}>
                    <SelectTrigger data-testid="tx-from-account-select"><SelectValue placeholder={tr("Origem")} /></SelectTrigger>
                    <SelectContent>
                      {accs.map(a => <SelectItem key={a.id} value={a.id}>{tr(a.name)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                )}
                {(sourceCurrency !== targetCurrency || form.type === "transfer") && (
                <div className="col-span-2 grid grid-cols-2 gap-3 rounded-xl bg-[#F1EFE7] p-3">
                  <div>
                    <Label>Cotação ({targetCurrency} por {sourceCurrency})</Label>
                    <Input type="number" step="0.000001" value={form.exchange_rate} required data-testid="tx-exchange-rate-input"
                      onChange={e => {
                        const rate = e.target.value;
                        const target = form.type === "transfer" && rate && form.amount
                          ? (Number(form.amount) * Number(rate)).toFixed(2) : form.target_amount;
                        setRateError("");
                        setForm({
                          ...form,
                          exchange_rate: rate,
                          target_amount: target,
                          rate_source: "manual",
                          rate_estimated: false,
                        });
                      }} />
                  </div>
                  {form.type === "transfer" && (
                    <div>
                      <Label>Valor recebido ({targetCurrency})</Label>
                      <Input type="number" step="0.01" value={form.target_amount} required data-testid="tx-target-amount-input"
                        onChange={e => {
                          const target = e.target.value;
                          const rate = target && form.amount ? Number(target) / Number(form.amount) : "";
                          setForm({ ...form, target_amount: target, exchange_rate: rate ? String(rate) : "", rate_source: "manual" });
                        }} />
                    </div>
                  )}
                  {form.type !== "transfer" && convertedAmount !== null && (
                    <div className="col-span-2 rounded-lg bg-white/70 px-3 py-2 text-sm text-[#061B4A]" data-testid="tx-conversion-preview">
                      {fmtMoney(numericAmount, sourceCurrency)} ≈ {fmtMoney(convertedAmount, targetCurrency)}
                    </div>
                  )}
                  <p className="col-span-2 text-xs text-[#6B7068]">
                    {rateLoading
                      ? tr("Buscando cotação automática...")
                      : rateError
                        ? tr("Cotação automática indisponível: {error} Informe a taxa manualmente.", { error: rateError })
                        : form.rate_source === "automatic"
                          ? form.rate_estimated
                            ? tr("Estimativa com a última cotação disponível de {date}. Você pode ajustar pelo valor real do banco.", { date: fmtDate(form.rate_date) })
                            : tr("Cotação automática de {date}; ajuste pelo valor real do banco se necessário.", { date: fmtDate(form.rate_date) })
                          : tr("Cotação ajustada manualmente.")}
                  </p>
                </div>
                )}
                {form.type === "transfer" && (
                <div>
                  <Label>{tr("Para conta")}</Label>
                  <Select value={form.to_account_id} onValueChange={(v) => setForm({ ...form, to_account_id: v })}>
                    <SelectTrigger data-testid="tx-to-account-select"><SelectValue placeholder={tr("Destino")} /></SelectTrigger>
                    <SelectContent>
                      {accs.map(a => <SelectItem key={a.id} value={a.id}>{tr(a.name)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                )}
                <div className="col-span-2">
                  <Label>{tr("Forma de pagamento")}</Label>
                  <Input value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })}
                    placeholder="Ex: Cartão de crédito" data-testid="tx-payment-input" />
                </div>
                {!editing && form.type !== "transfer" && (
                <div className="col-span-2">
                  <Label>{tr("Repetir (pagamento recorrente)")}</Label>
                  <Select value={form.repeat} onValueChange={(v) => setForm({ ...form, repeat: v })}>
                    <SelectTrigger data-testid="tx-repeat-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tr("Não repetir")}</SelectItem>
                      <SelectItem value="weekly">{tr("Semanal")}</SelectItem>
                      <SelectItem value="monthly">{tr("Mensal")}</SelectItem>
                      <SelectItem value="quarterly">{tr("Trimestral")}</SelectItem>
                      <SelectItem value="semiannual">{tr("Semestral")}</SelectItem>
                      <SelectItem value="yearly">{tr("Anual")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.repeat !== "none" && (
                    <p className="text-xs text-[#6B7068] mt-1">{tr("Cria uma recorrência a partir desta data. Gerencie em Recorrências.")}</p>
                  )}
                </div>
                )}
                <div className="col-span-2">
                  <Label>{tr("Descrição")}</Label>
                  <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} data-testid="tx-description-input" />
                </div>
                <div className="col-span-2">
                  <Label>{tr("Observações")}</Label>
                  <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} data-testid="tx-notes-input" />
                </div>
              </div>
              <Button type="submit" disabled={rateLoading} data-testid="tx-submit-button" className="w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
                {rateLoading ? tr("Buscando cotação...") : editing ? tr("Salvar alterações") : tr("Salvar")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="card-soft p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            <SlidersHorizontal size={16} />
            <span className="text-xs uppercase font-medium tracking-[0.06em]">{tr("Filtros")}</span>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              data-testid="clear-filters-btn"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#6B7068] hover:text-[#D9453B] rounded-lg px-2.5 py-1.5 hover:bg-rose-50 transition-colors"
            >
              <X size={14} /> {tr("Limpar")}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.06em] font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>{tr("Tipo")}</label>
            <select value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}
              data-testid="filter-type" className="w-full bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
              <option value="">{tr("Todos")}</option>
              <option value="income">{tr("Receita")}</option>
              <option value="expense">{tr("Despesa")}</option>
              <option value="transfer">{tr("Transferência")}</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.06em] font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>{tr("Status")}</label>
            <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}
              data-testid="filter-status" className="w-full bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
              <option value="">{tr("Todos")}</option>
              <option value="paid">{tr("Pago")}</option>
              <option value="pending">{tr("Pendente")}</option>
              <option value="cancelled">{tr("Cancelado")}</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.06em] font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>{tr("Categoria")}</label>
            <select value={filter.category_id} onChange={e => setFilter({ ...filter, category_id: e.target.value })}
              data-testid="filter-category" className="w-full bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
              <option value="">{tr("Todas")}</option>
              {cats.map(c => <option key={c.id} value={c.id}>{tr(c.name)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.06em] font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>{tr("Mês")}</label>
            <select value={filter.month} onChange={e => setFilter({ ...filter, month: e.target.value, year: e.target.value && !filter.year ? String(now.getFullYear()) : filter.year })}
              data-testid="filter-month" className="w-full bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
              <option value="">{tr("Todos")}</option>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.06em] font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>{tr("Ano")}</label>
            <select value={filter.year} onChange={e => setFilter({ ...filter, year: e.target.value })}
              data-testid="filter-year" className="w-full bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
              <option value="">{tr("Todos")}</option>
              {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.06em] font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>{tr("Carteira")}</label>
            <select value={filter.account_id} onChange={e => setFilter({ ...filter, account_id: e.target.value })}
              data-testid="filter-account" className="w-full bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
              <option value="">{tr("Todas")}</option>
              {accs.map(a => <option key={a.id} value={a.id}>{tr(a.name)}</option>)}
            </select>
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={onFileSelected} data-testid="receipt-file-input" />

      {selected.length > 0 && (
        <div className="card-soft flex items-center justify-between py-3" data-testid="bulk-action-bar">
          <span className="text-sm text-[#061B4A] font-medium">{selected.length} selecionado(s)</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSelected([])} className="rounded-xl" data-testid="bulk-clear-btn">{tr("Limpar")}</Button>
            <Button onClick={() => setBulkConfirm(true)} data-testid="bulk-delete-btn" className="bg-[#D9453B] hover:bg-[#b8392f] rounded-xl">
              <Trash2 size={16} className="mr-1" /> {tr("Excluir selecionados")}
            </Button>
          </div>
        </div>
      )}

      <div className="card-soft overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-[#F1EFE7] text-[#6B7068]">
            <tr>
              <th className="py-3 px-4 w-10">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                  data-testid="bulk-select-all" className="accent-[#061B4A] w-4 h-4 cursor-pointer"
                  disabled={selectableIds().length === 0} />
              </th>
              <th className="text-left py-3 px-4">{tr("Data")}</th>
              <th className="text-left py-3 px-4">{tr("Descrição")}</th>
              <th className="text-left py-3 px-4">{tr("Categoria")}</th>
              <th className="text-left py-3 px-4">{tr("Tipo")}</th>
              <th className="text-left py-3 px-4">{tr("Status")}</th>
              <th className="text-right py-3 px-4">{tr("Valor")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={8} className="text-center py-12 text-[#6B7068]">{tr("Nenhum lançamento")}</td></tr>
            )}
            {items.map(t => {
              const cat = cats.find(c => c.id === t.category_id);
              return (
                <tr key={t.id} className={`border-b border-[#E5E4E0] ${t.overdue ? "bg-red-50/60" : ""} ${selected.includes(t.id) ? "bg-[#F1EFE7]" : ""}`} data-testid={`tx-row-${t.id}`}>
                  <td className="py-3 px-4">
                    {t.editable !== false ? (
                      <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggleSelect(t.id)}
                        data-testid={`tx-select-${t.id}`} className="accent-[#061B4A] w-4 h-4 cursor-pointer" />
                    ) : null}
                  </td>
                  <td className="py-3 px-4">{fmtDate(t.date)}</td>
                  <td className="py-3 px-4 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{t.description || "—"}</span>
                      {(t.recurrence_id || t.notes === "(recorrente)") && (
                        <span data-testid={`tx-recurrent-badge-${t.id}`}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-[#061B4A] bg-[#E7FAF5] rounded-full px-2 py-0.5">
                          <Repeat size={10} /> {tr("Recorrente")}
                        </span>
                      )}
                      {t.source === "installment" && (
                        <span data-testid={`tx-installment-badge-${t.id}`}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-[#8A5A00] bg-orange-50 rounded-full px-2 py-0.5">
                          <CreditCard size={10} /> {tr("Parcela")}
                        </span>
                      )}
                      {t.overdue && (
                        <span data-testid={`tx-overdue-badge-${t.id}`}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-[#D9453B] bg-red-50 rounded-full px-2 py-0.5">
                          {tr("Atrasada")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {cat ? <span className="inline-flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />{tr(cat.name)}
                    </span> : "—"}
                  </td>
                  <td className="py-3 px-4">{TYPE_LABEL[t.type]}</td>
                  <td className="py-3 px-4">
                    <span className={`pill pill-${t.status}`}>{STATUS_LABEL[t.status]}</span>
                  </td>
                  <td className={`py-3 px-4 text-right font-medium ${
                    t.type === "income" ? "text-emerald-600" : t.type === "expense" ? "text-rose-600" : "text-[#1A1C1A]"
                  }`}>
                    <div>{t.type === "expense" ? "-" : t.type === "income" ? "+" : ""}{fmtMoney(t.amount, t.currency || curr)}</div>
                    {t.type === "transfer" && t.target_currency && (
                      <div className="text-xs text-[#6B7068]">→ {fmtMoney(t.target_amount ?? t.amount, t.target_currency)}</div>
                    )}
                    {t.type !== "transfer" && (t.currency || curr) !== curr && (
                      <div className="text-xs text-[#6B7068]">≈ {fmtMoney(t.base_amount || 0, curr)}</div>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-1 justify-end items-center">
                      {t.editable === false ? (
                        t.source === "installment" ? (
                          <button onClick={() => payInstallment(t)} data-testid={`tx-installment-pay-${t.id}`}
                            className={`p-1 ${t.status === "paid" ? "text-emerald-600" : "text-[#6B7068] hover:text-emerald-600"}`}
                            title={t.status === "paid" ? "Marcar como pendente" : "Confirmar pagamento"}>
                            <Check size={16} />
                          </button>
                        ) : (
                          <span className="text-xs text-[#6B7068] italic pr-1" title={tr("Editar em Parcelamentos")}>vinculado</span>
                        )
                      ) : (
                      <>
                      {t.status !== "cancelled" && (
                        <button
                          onClick={() => payTransaction(t)}
                          data-testid={`tx-pay-${t.id}`}
                          className={`p-1 rounded ${
                            t.status === "paid"
                              ? "text-emerald-600 hover:bg-emerald-50"
                              : t.overdue
                                ? "text-rose-600 hover:bg-rose-50 animate-pulse"
                                : "text-[#6B7068] hover:text-emerald-600 hover:bg-emerald-50"
                          }`}
                          title={t.status === "paid" ? "Marcar como pendente" : "Confirmar pagamento"}
                        >
                          <Check size={16} />
                        </button>
                      )}
                      {t.receipt ? (
                        <>
                          <button onClick={() => viewReceipt(t)} className="text-[#061B4A] hover:bg-[#F1EFE7] rounded p-1" data-testid={`tx-receipt-view-${t.id}`} title={tr("Ver comprovante")}>
                            <Eye size={16} />
                          </button>
                          <button onClick={() => removeReceipt(t)} className="text-[#6B7068] hover:text-[#D9453B] p-1" data-testid={`tx-receipt-remove-${t.id}`} title={tr("Remover comprovante")}>
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => triggerUpload(t)} disabled={uploadingId === t.id}
                          className="text-[#6B7068] hover:text-[#061B4A] p-1 disabled:opacity-40" data-testid={`tx-receipt-upload-${t.id}`} title={tr("Anexar comprovante")}>
                          <Paperclip size={16} className={uploadingId === t.id ? "animate-pulse" : ""} />
                        </button>
                      )}
                      <button onClick={() => openEdit(t)} className="text-[#6B7068] hover:text-[#061B4A] p-1" data-testid={`tx-edit-${t.id}`} title={tr("Editar")}>
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => setConfirmDel(t)} className="text-[#6B7068] hover:text-[#D9453B] p-1" data-testid={`tx-delete-${t.id}`} title={tr("Excluir")}>
                        <Trash2 size={16} />
                      </button>
                      </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title={tr("Excluir lançamento?")}
        description={confirmDel ? tr("{item}. Esta ação não pode ser desfeita.", { item: `"${confirmDel.description || tr("Sem descrição")}" - ${fmtMoney(confirmDel.amount, confirmDel.currency || curr)}` }) : ""}
        onConfirm={remove}
        testId="tx-confirm-delete"
      />

      <ConfirmDialog
        open={bulkConfirm}
        onOpenChange={setBulkConfirm}
        title={tr("Excluir selecionados?")}
        description={tr("{count} lançamento(s) serão excluídos permanentemente. Esta ação não pode ser desfeita.", { count: selected.length })}
        onConfirm={bulkDelete}
        testId="tx-bulk-confirm-delete"
      />
    </div>
  );
}
