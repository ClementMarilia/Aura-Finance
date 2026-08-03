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
import { Plus, Check, Trash2, Pencil, ArrowRight } from "lucide-react";
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
    setEditing(null);
    setForm({ person: "", amount: "", due_date: new Date().toISOString().slice(0, 10), description: "", account_id: "", currency: curr });
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

  const receive = async (id) => {
    try {
      const r = await api.post(`/receivables/${id}/receive`);
      toast.success(r.data?.status === "received" ? tr("Recebido! Receita lançada na carteira") : "Recebimento desfeito");
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };
  const remove = async () => {
    if (!confirmDel) return;
    await api.delete(`/receivables/${confirmDel.id}`);
    setConfirmDel(null);
    toast.success(tr("Conta excluída"));
    load();
  };

  return (
    <div className="space-y-6" data-testid="receivables-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Contas a Receber")}</h1>
          <p className="text-[#6B7068]">{tr("Valores a receber e a pagar, sem misturar com receitas e despesas")}</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={openNew} data-testid="new-receivable-button" className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
              <Plus size={16} className="mr-1" /> {tr("Nova conta a receber")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Editar conta a receber" : tr("Nova conta a receber")}</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>{tr("Pessoa / Empresa")}</Label>
                <Input value={form.person} required data-testid="rec-person-input"
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
              <Button type="submit" className="w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl" data-testid="rec-submit-button">
                {editing ? tr("Salvar alterações") : tr("Salvar")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex justify-end">
        <select value={currencyFilter} onChange={event => setCurrencyFilter(event.target.value)}
          data-testid="receivable-currency-filter" className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
          <option value="">{tr("Todas as moedas")}</option>
          {CURRENCIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card-soft border-l-4 border-l-emerald-500">
          <p className="text-sm text-[#6B7068]">{tr("A receber de despesas compartilhadas")}</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700" style={{ fontFamily: "Outfit" }}>
            {fmtMoney(sharedReceiveTotal, curr)}
          </p>
          <p className="mt-1 text-xs text-[#6B7068]">
            {tr("{count} valor(es) pendente(s)", { count: sharedToReceive.length })}
          </p>
        </div>
        <div className="card-soft border-l-4 border-l-rose-500">
          <p className="text-sm text-[#6B7068]">{tr("A pagar de despesas compartilhadas")}</p>
          <p className="mt-1 text-2xl font-semibold text-rose-600" style={{ fontFamily: "Outfit" }}>
            {fmtMoney(sharedPayTotal, curr)}
          </p>
          <p className="mt-1 text-xs text-[#6B7068]">
            {tr("{count} valor(es) pendente(s)", { count: sharedToPay.length })}
          </p>
        </div>
      </div>

      {(sharedToReceive.length > 0 || sharedToPay.length > 0) && (
        <div className="card-soft overflow-x-auto p-0">
          <div className="flex items-center justify-between gap-3 p-4 pb-2">
            <div>
              <h2 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>
                {tr("Pendências compartilhadas")}
              </h2>
              <p className="text-xs text-[#6B7068]">
                {tr("Esses valores não são novas receitas ou despesas.")}
              </p>
            </div>
            <Link to="/acertos" className="inline-flex items-center gap-1 text-sm font-medium text-[#0D5DD7]">
              {tr("Ver acertos")} <ArrowRight size={14} />
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[#F1EFE7] text-[#6B7068]">
              <tr>
                <th className="text-left py-3 px-4">{tr("Pessoa")}</th>
                <th className="text-left py-3 px-4">{tr("Despesa")}</th>
                <th className="text-left py-3 px-4">{tr("Situação")}</th>
                <th className="text-right py-3 px-4">{tr("Valor")}</th>
              </tr>
            </thead>
            <tbody>
              {[...sharedToReceive, ...sharedToPay].map(row => {
                const receiving = row.creditor_id === user.id;
                const person = receiving ? row.debtor : row.creditor;
                return (
                  <tr key={`${row.expense_id}-${row.debtor_id}`} className="border-b border-[#E5E4E0]">
                    <td className="py-3 px-4 font-medium">{person?.name || "—"}</td>
                    <td className="py-3 px-4">{row.title}</td>
                    <td className={`py-3 px-4 font-medium ${receiving ? "text-emerald-700" : "text-rose-600"}`}>
                      {receiving ? tr("A receber") : tr("A pagar")}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold">
                      {fmtMoney(row.amount, row.currency || curr)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card-soft overflow-x-auto p-0">
        <div className="p-4 pb-2">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>
            {tr("Outras contas a receber")}
          </h2>
          <p className="text-xs text-[#6B7068]">
            {tr("Cobranças e valores cadastrados manualmente")}
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[#F1EFE7] text-[#6B7068]">
            <tr>
              <th className="text-left py-3 px-4">{tr("Pessoa / Empresa")}</th>
              <th className="text-left py-3 px-4">{tr("Descrição")}</th>
              <th className="text-left py-3 px-4">{tr("Vencimento")}</th>
              <th className="text-left py-3 px-4">{tr("Status")}</th>
              <th className="text-right py-3 px-4">{tr("Valor")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-[#6B7068]">{tr("Nenhum registro")}</td></tr>}
            {list.map(r => (
              <tr key={r.id} className="border-b border-[#E5E4E0]" data-testid={`rec-row-${r.id}`}>
                <td className="py-3 px-4 font-medium">{r.person}</td>
                <td className="py-3 px-4">{r.description || "—"}</td>
                <td className="py-3 px-4">{fmtDate(r.due_date)}</td>
                <td className="py-3 px-4">
                  <span className={`pill ${r.status === "received" ? "pill-paid" : "pill-pending"}`}>
                    {r.status === "received" ? tr("Recebido") : tr("Pendente")}
                  </span>
                </td>
                <td className="py-3 px-4 text-right font-semibold">{fmtMoney(r.amount, r.currency || curr)}</td>
                <td className="py-3 px-4 flex gap-1 justify-end">
                  <button onClick={() => receive(r.id)} className="text-emerald-600 hover:text-emerald-800 p-1" data-testid={`rec-receive-${r.id}`} title={tr("Marcar como recebido")}>
                    <Check size={16} />
                  </button>
                  <button onClick={() => openEdit(r)} className="text-[#6B7068] hover:text-[#061B4A] p-1" data-testid={`rec-edit-${r.id}`} title={tr("Editar")}>
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setConfirmDel(r)} className="text-[#6B7068] hover:text-[#D9453B] p-1" data-testid={`rec-delete-${r.id}`} title={tr("Excluir")}>
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
