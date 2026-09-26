import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { CURRENCIES, fmtMoney, fmtDate, formatApiError, postCreate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import AmountInput from "@/components/AmountInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Check, Trash2, Pencil, ArrowRight, CalendarClock } from "lucide-react";
import { defaultAccountFor } from "@/lib/accounts";
import { toast } from "sonner";

import { translate as tr } from "@/i18n";
export default function Receivables() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [list, setList] = useState([]);
  const [sharedRows, setSharedRows] = useState([]);
  const [accs, setAccs] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ person: "", amount: "", due_date: new Date().toISOString().slice(0, 10), description: "", account_id: "", currency: curr });
  const [confirmDel, setConfirmDel] = useState(null);
  const [confirmReceive, setConfirmReceive] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [currencyFilter, setCurrencyFilter] = useState("");

  const load = useCallback(() => Promise.all([
    api.get("/receivables", {
      params: currencyFilter ? { currency: currencyFilter } : {},
    }),
    api.get("/settlements"),
  ]).then(([receivablesResponse, settlementsResponse]) => {
    setList(receivablesResponse.data);
    setSharedRows((settlementsResponse.data?.rows || []).filter(row => (
      !currencyFilter || (row.currency || curr) === currencyFilter
    )));
  }), [currencyFilter, curr]);
  useEffect(() => { api.get("/accounts").then(r => setAccs(r.data || [])); }, []);
  useEffect(() => { load(); }, [load]);

  const sharedToReceive = sharedRows.filter(row => row.creditor_id === user.id);
  const sharedToPay = sharedRows.filter(row => row.debtor_id === user.id);
  const sharedReceiveTotal = sharedToReceive.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const sharedPayTotal = sharedToPay.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const openNew = () => {
    // Receiving credits a wallet, so new items start on one (same rule as Lançamentos).
    const account = defaultAccountFor(accs, curr);
    setEditing(null);
    setForm({ person: "", amount: "", due_date: new Date().toISOString().slice(0, 10), description: "", account_id: account?.id || "", currency: account?.currency || curr });
    setOpen(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    setForm({ person: r.person, amount: String(r.amount), due_date: r.due_date, description: r.description || "", account_id: r.account_id || "", currency: r.currency || curr });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = { ...form, amount: parseFloat(form.amount), account_id: form.account_id || null };
      if (editing) {
        await api.put(`/receivables/${editing.id}`, body);
        toast.success(tr("Atualizado"));
      } else {
        await postCreate("/receivables", body);
        toast.success(tr("Conta a receber criada"));
      }
      setOpen(false); setEditing(null);
      setForm({ person: "", amount: "", due_date: new Date().toISOString().slice(0, 10), description: "", account_id: "", currency: curr });
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  // Sends the target state (not a toggle) and ignores taps while a request
  // is in flight, so a double tap can never record the income twice.
  const receive = async () => {
    if (!confirmReceive || busyId) return;
    const target = confirmReceive.status !== "received";
    setBusyId(confirmReceive.id);
    try {
      const r = await api.post(`/receivables/${confirmReceive.id}/receive`, { received: target });
      if (r.data?.status !== "received") toast.success(tr("Recebimento desfeito"));
      else if (confirmReceive.account_id) toast.success(tr("Recebido! Receita lançada na carteira"));
      else toast.warning(tr("Recebido, mas sem carteira: edite a cobrança e escolha uma para o saldo refletir."));
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusyId(null);
      setConfirmReceive(null);
    }
  };
  const remove = async () => {
    if (!confirmDel) return;
    try {
      await api.delete(`/receivables/${confirmDel.id}`);
      toast.success(tr("Conta excluída"));
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setConfirmDel(null);
    }
  };
  const accountName = (id) => {
    const account = accs.find(a => a.id === id);
    return account ? tr(account.name) : tr("nenhuma carteira");
  };
  const todayIso = new Date().toISOString().slice(0, 10);
  const pendingOwn = list.filter(r => r.status !== "received");
  const pendingOwnTotal = pendingOwn.reduce((sum, r) => sum + Number(r.base_amount ?? r.amount ?? 0), 0);

  return (
    <div className="space-y-4 md:space-y-6" data-testid="receivables-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Contas a Receber")}</h1>
          <p className="text-sm text-[#6B7068]">{tr("Valores a receber e a pagar, sem misturar com receitas e despesas")}</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={openNew} data-testid="new-receivable-button" className="min-h-[44px] w-full sm:w-auto bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
              <Plus size={16} className="mr-1" /> {tr("Nova conta a receber")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? tr("Editar conta a receber") : tr("Nova conta a receber")}</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>{tr("Pessoa / Empresa")}</Label>
                <Input value={form.person} required data-testid="rec-person-input" placeholder={tr("Ex: Ana, Empresa X")}
                  onChange={e => setForm({ ...form, person: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{tr("Valor")}</Label>
                  <AmountInput value={form.amount} currency={form.currency || curr} required data-testid="rec-amount-input"
                    onValueChange={amount => setForm({ ...form, amount })} /></div>
                <div><Label>{tr("Data prevista")}</Label>
                  <Input type="date" value={form.due_date} required data-testid="rec-date-input"
                    onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
              </div>
              <div><Label>{tr("Descrição")}</Label>
                <Input value={form.description} data-testid="rec-description-input"
                  onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div><Label>{tr("Moeda")}</Label>
                <Select value={form.currency} onValueChange={value => setForm({
                  ...form,
                  currency: value,
                  account_id: accs.some(account => account.id === form.account_id && (account.currency || curr) === value)
                    ? form.account_id : "",
                })}>
                  <SelectTrigger data-testid="rec-currency-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select></div>
              <div><Label>{tr("Carteira (onde o valor será creditado ao receber)")}</Label>
                <Select value={form.account_id} onValueChange={v => {
                  const account = accs.find(item => item.id === v);
                  setForm({ ...form, account_id: v, currency: account?.currency || form.currency });
                }}>
                  <SelectTrigger data-testid="rec-account-select"><SelectValue placeholder={tr("Selecione a carteira")} /></SelectTrigger>
                  <SelectContent>
                    {accs.filter(a => (a.currency || curr) === form.currency).map(a => (
                      <SelectItem key={a.id} value={a.id}>{tr(a.name)} ({a.currency || curr})</SelectItem>
                    ))}
                  </SelectContent>
                </Select></div>
              <Button type="submit" className="min-h-[44px] w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl" data-testid="rec-submit-button">
                {editing ? tr("Salvar alterações") : tr("Salvar")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {(currencyFilter || new Set([...list, ...sharedRows].map(item => item.currency || curr)).size > 1) && (
        <div className="flex justify-end">
          <select value={currencyFilter} onChange={event => setCurrencyFilter(event.target.value)}
            data-testid="receivable-currency-filter" className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
            <option value="">{tr("Todas as moedas")}</option>
            {CURRENCIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
      )}

      <div className="card-soft p-4" data-testid="receivables-summary">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="stat-label">{tr("A receber")}</div>
            <div className="money-value mt-1 text-xl font-semibold text-emerald-600" style={{ fontFamily: "Outfit" }}>
              {fmtMoney(pendingOwnTotal + sharedReceiveTotal, curr)}
            </div>
          </div>
          <div className="text-right">
            <div className="stat-label">{tr("A pagar")}</div>
            <div className="money-value mt-1 text-xl font-semibold text-rose-600" style={{ fontFamily: "Outfit" }}>
              {fmtMoney(sharedPayTotal, curr)}
            </div>
          </div>
        </div>
        <div className="mt-2 text-xs text-[#6B7068]">
          {tr("{own} cobrança(s) · {shared} pendência(s) compartilhada(s)", { own: pendingOwn.length, shared: sharedToReceive.length + sharedToPay.length })}
        </div>
      </div>

      <section className="space-y-2" data-testid="receivables-list">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold" style={{ fontFamily: "Outfit" }}>{tr("Outras contas a receber")}</h2>
            <p className="text-xs text-[#6B7068]">{tr("Cobranças e valores cadastrados manualmente")}</p>
          </div>
        </div>
        {list.length === 0 && <div className="card-soft py-10 text-center text-sm text-[#6B7068]">{tr("Nenhum registro")}</div>}
        {list.map(r => {
          const received = r.status === "received";
          const overdue = !received && r.due_date < todayIso;
          return (
            <div key={r.id} className={`card-soft p-4 ${received ? "opacity-70" : ""}`} data-testid={`rec-row-${r.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-[#1A1C1A]">{r.person}</div>
                  <div className="truncate text-xs text-[#6B7068]">{r.description || "—"}</div>
                </div>
                <div className="money-value whitespace-nowrap font-semibold text-emerald-600">{fmtMoney(r.amount, r.currency || curr)}</div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className={`flex items-center gap-1 text-xs ${overdue ? "font-medium text-[#D9453B]" : "text-[#6B7068]"}`}>
                  <CalendarClock size={12} />
                  {received
                    ? tr("Recebido")
                    : overdue ? tr("Atrasada desde {date}", { date: fmtDate(r.due_date) }) : tr("Vence {date}", { date: fmtDate(r.due_date) })}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(r)} aria-label={tr("Editar")} data-testid={`rec-edit-${r.id}`}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#061B4A]"><Pencil size={16} /></button>
                  <button onClick={() => setConfirmDel(r)} aria-label={tr("Excluir")} data-testid={`rec-delete-${r.id}`}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-[#6B7068] hover:bg-rose-50 hover:text-[#D9453B]"><Trash2 size={16} /></button>
                  <button onClick={() => setConfirmReceive(r)} disabled={busyId === r.id} data-testid={`rec-receive-${r.id}`}
                    className={`flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium disabled:opacity-50 ${
                      received ? "bg-emerald-50 text-emerald-700" : "bg-[#061B4A] text-white hover:bg-[#1268F4]"
                    }`}>
                    <Check size={14} /> {received ? tr("Recebido") : tr("Receber")}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {(sharedToReceive.length > 0 || sharedToPay.length > 0) && (
        <section className="card-soft p-0 overflow-hidden" data-testid="receivables-shared">
          <div className="flex items-start justify-between gap-3 p-4 pb-2">
            <div>
              <h2 className="text-base font-semibold" style={{ fontFamily: "Outfit" }}>{tr("Pendências compartilhadas")}</h2>
              <p className="text-xs text-[#6B7068]">{tr("Esses valores não são novas receitas ou despesas.")}</p>
            </div>
            <Link to="/acertos" className="inline-flex min-h-[40px] shrink-0 items-center gap-1 text-sm font-medium text-[#1268F4]">
              {tr("Ver acertos")} <ArrowRight size={14} />
            </Link>
          </div>
          <div className="divide-y divide-[#E5E4E0]">
            {[...sharedToReceive, ...sharedToPay].map(row => {
              const receiving = row.creditor_id === user.id;
              const person = receiving ? row.debtor : row.creditor;
              return (
                <div key={`${row.expense_id}-${row.debtor_id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[#1A1C1A]">{person?.name || "—"}</div>
                    <div className="truncate text-xs text-[#6B7068]">{row.title} · {receiving ? tr("A receber") : tr("A pagar")}</div>
                  </div>
                  <div className={`money-value whitespace-nowrap text-sm font-semibold ${receiving ? "text-emerald-600" : "text-rose-600"}`}>
                    {fmtMoney(row.amount, row.currency || curr)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={!!confirmReceive}
        onOpenChange={(v) => !v && !busyId && setConfirmReceive(null)}
        variant="primary"
        title={confirmReceive?.status === "received" ? tr("Desfazer recebimento?") : tr("Confirmar recebimento?")}
        description={confirmReceive ? (
          confirmReceive.status === "received"
            ? tr("A receita de {amount} será removida de {wallet} e a cobrança volta a ficar pendente.", {
              amount: fmtMoney(confirmReceive.amount, confirmReceive.currency || curr), wallet: accountName(confirmReceive.account_id),
            })
            : tr("{amount} de {name} entrará em {wallet} como receita.", {
              amount: fmtMoney(confirmReceive.amount, confirmReceive.currency || curr), name: confirmReceive.person,
              wallet: accountName(confirmReceive.account_id),
            })
        ) : ""}
        confirmLabel={confirmReceive?.status === "received" ? tr("Desfazer") : tr("Confirmar recebimento")}
        onConfirm={receive}
        testId="rec-confirm-receive"
      />

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title={tr("Excluir conta a receber?")}
        description={confirmDel ? tr("{item}. Esta ação não pode ser desfeita.", { item: `"${confirmDel.person}" - ${fmtMoney(confirmDel.amount, confirmDel.currency || curr)}` }) : ""}
        onConfirm={remove}
        testId="rec-confirm-delete"
      />
    </div>
  );
}
