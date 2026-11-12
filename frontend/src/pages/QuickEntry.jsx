import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import api, { CURRENCIES, formatApiError, postCreate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import AIEntry from "@/components/AIEntry";
import ReceiptScanner from "@/components/ReceiptScanner";
import AmountInput from "@/components/AmountInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defaultAccountFor } from "@/lib/accounts";
import { localToday } from "@/lib/aiAssistant";
import { applyAIDraftToForm, transactionPayloadFromForm } from "@/lib/transactionForm";
import { translate as tr } from "@/i18n";

const empty = currency => ({ type: "expense", status: "paid", amount: "", date: localToday(), description: "", notes: "", currency, account_id: "", category_id: "" });

// This route intentionally loads no dashboard, transaction list or Layout polling.
export default function QuickEntry() {
  const { user } = useAuth();
  const currency = user?.currency || "EUR";
  const [params] = useSearchParams();
  const [form, setForm] = useState(() => empty(currency));
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [generation, setGeneration] = useState(0);
  const flight = useRef(false);
  useEffect(() => {
    const manifest = document.querySelector('link[rel="manifest"]');
    const previous = manifest?.getAttribute("href");
    manifest?.setAttribute("href", "/quick-manifest.json");
    return () => { if (previous) manifest?.setAttribute("href", previous); };
  }, []);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cats = await api.get("/categories");
        const accs = await api.get("/accounts");
        if (!active) return;
        setCategories(cats.data); setAccounts(accs.data);
        const account = defaultAccountFor(accs.data, currency);
        setForm(current => ({ ...current, account_id: account?.id || "", currency: account?.currency || currency }));
        setReady(true);
      } catch (error) { if (active) setLoadError(formatApiError(error)); }
    })();
    return () => { active = false; };
  }, [currency]);
  const change = (key, value) => { setSaved(false); setForm(current => ({ ...current, [key]: value })); };
  const interpret = draft => { setSaved(false); setForm(current => applyAIDraftToForm(current, draft, currency)); };
  const save = async event => {
    event.preventDefault();
    if (flight.current) return;
    const account = accounts.find(item => item.id === form.account_id);
    if (!ready || !Number.isFinite(Number(form.amount)) || Number(form.amount) <= 0 || !account || account.currency !== form.currency) {
      toast.error(tr("Revise os dados antes de salvar.")); return;
    }
    flight.current = true; setSaving(true);
    try {
      await postCreate("/transactions", transactionPayloadFromForm(form, { sourceCurrency: form.currency }));
      setSaved(true); toast.success(tr("Lançamento salvo"));
      setForm({ ...empty(currency), account_id: account.id, currency: account.currency });
      setGeneration(value => value + 1);
    } catch (error) { toast.error(formatApiError(error)); }
    finally { flight.current = false; setSaving(false); }
  };
  return <main className="mx-auto min-h-screen max-w-lg space-y-4 p-4 pb-8" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}>
    <header className="flex items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{tr("Adicionar rápido")}</h1><Link className="underline" to="/lancamentos">{tr("Lançamentos")}</Link></header>
    <details className="rounded-xl border p-3 text-sm"><summary>{tr("Como criar atalho")}</summary><p className="mt-2">{tr("Abra esta página no navegador do celular. No iPhone, use Compartilhar e Adicionar à Tela de Início. No Android, use o menu do navegador e Adicionar à tela inicial ou Instalar.")}</p></details>
    {loadError && <div role="alert">{loadError}<Button type="button" variant="outline" onClick={() => window.location.reload()}>{tr("Tentar novamente")}</Button></div>}
    {!ready ? <p role="status">{tr("Carregando...")}</p> : <>
      {saved && <p role="status" className="rounded-lg border p-3">{tr("Lançamento salvo")}</p>}
      <form onSubmit={save} className="space-y-4">
        <fieldset disabled={saving} className="min-w-0 space-y-4">
          <AIEntry key={`ai-${generation}`} expandInitially={params.get("modo") !== "digitar" && params.get("modo") !== "escanear"} onResult={interpret} onBasicResult={interpret} />
          <ReceiptScanner key={`receipt-${generation}`} autoStart={params.get("modo") === "escanear"} onResult={({ total, date, merchant, category_id }) => setForm(current => ({ ...current, amount: total ? total.toFixed(2) : current.amount, date: date || current.date, description: merchant || current.description, category_id: category_id || current.category_id }))} />
          <div className="grid grid-cols-2 gap-3">
            <label>{tr("Tipo")}<select className="w-full rounded-lg border bg-transparent p-2" value={form.type} onChange={e => setForm(current => ({ ...current, type: e.target.value, category_id: "" }))}><option value="expense">{tr("Despesa")}</option><option value="income">{tr("Receita")}</option></select></label>
            <label>{tr("Status")}<select className="w-full rounded-lg border bg-transparent p-2" value={form.status} onChange={e => change("status", e.target.value)}><option value="paid">{tr("Pago")}</option><option value="pending">{tr("Pendente")}</option></select></label>
            <label>{tr("Valor")}<AmountInput aria-label={tr("Valor")} value={form.amount} currency={form.currency} onValueChange={value => change("amount", value)} required /></label>
            <label>{tr("Data")}<Input type="date" value={form.date} onChange={e => change("date", e.target.value)} required /></label>
          </div>
          <label className="block">{tr("Descrição")}<Input value={form.description} maxLength={240} onChange={e => change("description", e.target.value)} required /></label>
          <label className="block">{tr("Moeda")}<select className="w-full rounded-lg border bg-transparent p-2" value={form.currency} onChange={e => setForm(current => ({ ...current, currency: e.target.value, account_id: "" }))}>{CURRENCIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="block">{tr("Conta")}<select className="w-full rounded-lg border bg-transparent p-2" value={form.account_id} onChange={e => change("account_id", e.target.value)} required><option value="">{tr("Selecione")}</option>{accounts.filter(item => item.currency === form.currency && !item.archived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="block">{tr("Categoria")}<select className="w-full rounded-lg border bg-transparent p-2" value={form.category_id} onChange={e => change("category_id", e.target.value)}><option value="">{tr("Selecione")}</option>{categories.filter(item => item.kind === form.type || item.kind === "both").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="block">{tr("Observações")}<textarea className="w-full rounded-lg border bg-transparent p-2" maxLength={1000} value={form.notes} onChange={e => change("notes", e.target.value)} /></label>
          <Button className="min-h-[48px] w-full" type="submit" disabled={saving}>{saving ? tr("Salvando...") : tr("Salvar")}</Button>
        </fieldset>
      </form>
      <Link className="block underline" to="/parcelamentos">{tr("Nova compra parcelada")}</Link>
    </>}
  </main>;
}
