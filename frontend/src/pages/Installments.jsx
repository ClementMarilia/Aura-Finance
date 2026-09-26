import { useEffect, useState } from "react";
import api, { CURRENCIES, fmtMoney, fmtDate, formatApiError, postCreate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import AmountInput from "@/components/AmountInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Check, Trash2, Pencil, ChevronDown, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { defaultAccountFor } from "@/lib/accounts";
import { installmentAmounts, purchaseProgress } from "@/lib/installments";

import { translate as tr } from "@/i18n";

const today = () => new Date().toISOString().slice(0, 10);

function ProgressBar({ value, total, className = "" }) {
  const percent = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-[#F1EFE7] ${className}`} role="progressbar"
      aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
    </div>
  );
}

export default function Installments() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [list, setList] = useState([]);
  const [cats, setCats] = useState([]);
  const [accs, setAccs] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [confirmPay, setConfirmPay] = useState(null); // { parcel, purchase }
  const [expanded, setExpanded] = useState({});
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [editForm, setEditForm] = useState({ description: "", category_id: "", payment_method: "", account_id: "", currency: curr });
  const emptyForm = () => {
    // Same rule as Lançamentos: parcels leave a wallet when confirmed, so a
    // purchase must start on one.
    const account = defaultAccountFor(accs, curr);
    return {
      description: "", total_amount: "", installments: 2,
      first_date: today(), category_id: "", payment_method: "",
      account_id: account?.id || "", currency: account?.currency || curr,
    };
  };
  const [form, setForm] = useState(emptyForm);

  const load = () => api.get("/installments/purchases", {
    params: currencyFilter ? { currency: currencyFilter } : {},
  }).then(r => setList(r.data));
  useEffect(() => {
    api.get("/categories").then(r => setCats(r.data));
    api.get("/accounts").then(r => setAccs(r.data || []));
  }, []);
  useEffect(() => {
    api.get("/installments/purchases", {
      params: currencyFilter ? { currency: currencyFilter } : {},
    }).then(r => setList(r.data));
  }, [currencyFilter]);

  const openNew = () => { setForm(emptyForm()); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      await postCreate("/installments/purchases", {
        ...form,
        total_amount: parseFloat(form.total_amount),
        installments: parseInt(form.installments, 10),
        category_id: form.category_id || null,
        account_id: form.account_id || null,
      });
      toast.success(tr("Parcelamento criado"));
      setOpen(false); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const openEdit = (p) => {
    setEditing(p);
    setEditForm({
      description: p.description,
      category_id: p.category_id || "",
      payment_method: p.payment_method || "",
      account_id: p.account_id || "",
      currency: p.currency || curr,
    });
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/installments/purchases/${editing.id}`, {
        description: editForm.description,
        category_id: editForm.category_id || null,
        payment_method: editForm.payment_method,
        account_id: editForm.account_id || null,
      });
      toast.success(tr("Atualizado"));
      setEditing(null); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  // Paying moves money out of a wallet, so it always goes through a
  // confirmation instead of a single accidental tap.
  const togglePay = async () => {
    if (!confirmPay) return;
    const { parcel } = confirmPay;
    try {
      await api.post(`/installments/${parcel.id}/pay`);
      toast.success(parcel.status === "paid" ? tr("Parcela reaberta") : tr("Parcela paga"));
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setConfirmPay(null);
    }
  };

  const removePurchase = async () => {
    if (!confirmDel) return;
    try {
      await api.delete(`/installments/purchases/${confirmDel.id}`);
      toast.success(tr("Parcelamento excluído"));
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setConfirmDel(null);
    }
  };

  const accountName = (id) => {
    const account = accs.find(a => a.id === id);
    return account ? tr(account.name) : null;
  };
  const preview = installmentAmounts(form.total_amount, form.installments);
  const showCurrencyFilter = currencyFilter || new Set(list.map(p => p.currency || curr)).size > 1;

  const allParcels = list.flatMap(p => p.installments_list);
  const pendingTotal = allParcels.filter(i => i.status === "pending").reduce((s, i) => s + (i.base_amount ?? i.amount), 0);
  const paidTotal = allParcels.filter(i => i.status === "paid").reduce((s, i) => s + (i.base_amount ?? i.amount), 0);

  return (
    <div className="space-y-4 md:space-y-6" data-testid="installments-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Parcelamentos")}</h1>
          <p className="text-sm text-[#6B7068]">{tr("Compras parceladas com geração automática")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} data-testid="new-installment-button" className="min-h-[44px] w-full sm:w-auto bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
              <Plus size={16} className="mr-1" /> {tr("Nova compra parcelada")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden">
            <DialogHeader><DialogTitle>{tr("Nova compra parcelada")}</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="min-w-0 space-y-3">
              <div><Label>{tr("Descrição")}</Label>
                <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required
                  placeholder={tr("Ex: Notebook, geladeira")} data-testid="inst-description-input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{tr("Valor total")}</Label>
                  <AmountInput value={form.total_amount} currency={form.currency || curr} required data-testid="inst-total-input"
                    onValueChange={total_amount => setForm({ ...form, total_amount })} /></div>
                <div><Label>{tr("Nº parcelas")}</Label>
                  <Input type="number" inputMode="numeric" min="1" max="120" value={form.installments} required data-testid="inst-count-input"
                    onChange={e => setForm({ ...form, installments: e.target.value })} /></div>
              </div>
              {preview.length > 0 && (
                <div className="rounded-xl bg-[#F1EFE7] px-3 py-2 text-sm text-[#1A1C1A]" data-testid="inst-preview">
                  {(() => {
                    const cur = form.currency || curr;
                    const high = preview.filter(value => value === preview[0]).length;
                    if (high === preview.length) {
                      return tr("{count}× de {amount}", { count: preview.length, amount: fmtMoney(preview[0], cur) });
                    }
                    // Leftover cents go to the first parcels (same rule as the backend).
                    return tr("{high}× de {first} e {low}× de {second}", {
                      high, first: fmtMoney(preview[0], cur),
                      low: preview.length - high, second: fmtMoney(preview[preview.length - 1], cur),
                    });
                  })()}
                </div>
              )}
              <div><Label>{tr("Primeira parcela")}</Label>
                <Input type="date" value={form.first_date} required data-testid="inst-date-input"
                  onChange={e => setForm({ ...form, first_date: e.target.value })} /></div>
              <div><Label>{tr("Carteira (pagamento sai daqui ao confirmar a parcela)")}</Label>
                <Select value={form.account_id} onValueChange={v => {
                  const account = accs.find(item => item.id === v);
                  setForm({ ...form, account_id: v, currency: account?.currency || form.currency });
                }}>
                  <SelectTrigger data-testid="inst-account-select"><SelectValue placeholder={tr("Selecione a carteira")} /></SelectTrigger>
                  <SelectContent>
                    {accs.map(a => (
                      <SelectItem key={a.id} value={a.id}>{tr(a.name)} ({a.currency || curr})</SelectItem>
                    ))}
                  </SelectContent>
                </Select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{tr("Categoria")}</Label>
                  <Select value={form.category_id} onValueChange={v => setForm({ ...form, category_id: v })}>
                    <SelectTrigger data-testid="inst-category-select"><SelectValue placeholder={tr("Selecione")} /></SelectTrigger>
                    <SelectContent>
                      {cats.map(c => <SelectItem key={c.id} value={c.id}>{tr(c.name)}</SelectItem>)}
                    </SelectContent>
                  </Select></div>
                <div><Label>{tr("Moeda")}</Label>
                  <Select value={form.currency} onValueChange={value => setForm({
                    ...form,
                    currency: value,
                    account_id: accs.some(account => account.id === form.account_id && (account.currency || curr) === value)
                      ? form.account_id : "",
                  })}>
                    <SelectTrigger data-testid="inst-currency-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                    </SelectContent>
                  </Select></div>
              </div>
              <div><Label>{tr("Forma de pagamento")}</Label>
                <Input value={form.payment_method} data-testid="inst-payment-input" placeholder={tr("Ex: Cartão de crédito")}
                  onChange={e => setForm({ ...form, payment_method: e.target.value })} /></div>
              <Button type="submit" className="min-h-[44px] w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl" data-testid="inst-submit-button">{tr("Criar")}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {showCurrencyFilter && (
        <div className="flex justify-end">
          <select value={currencyFilter} onChange={event => setCurrencyFilter(event.target.value)}
            data-testid="inst-currency-filter" className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
            <option value="">{tr("Todas as moedas")}</option>
            {CURRENCIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
      )}

      {list.length > 0 && (
        <div className="card-soft p-4" data-testid="inst-summary">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="stat-label">{tr("Falta pagar")}</div>
              <div className="money-value mt-1 text-xl font-semibold text-rose-600" style={{ fontFamily: "Outfit" }} data-testid="inst-pending-total">
                {fmtMoney(pendingTotal, curr)}
              </div>
            </div>
            <div className="text-right">
              <div className="stat-label">{tr("Total já pago")}</div>
              <div className="money-value mt-1 text-xl font-semibold text-emerald-600" style={{ fontFamily: "Outfit" }} data-testid="inst-paid-total">
                {fmtMoney(paidTotal, curr)}
              </div>
            </div>
          </div>
          <ProgressBar value={paidTotal} total={paidTotal + pendingTotal} className="mt-3" />
          <div className="mt-2 text-xs text-[#6B7068]">{tr("Só sai da carteira quando você confirmar o pagamento")}</div>
        </div>
      )}

      <div className="space-y-3">
        {list.length === 0 && <div className="card-soft text-center text-[#6B7068]">{tr("Nenhum parcelamento ainda")}</div>}
        {list.map(p => {
          const cur = p.currency || curr;
          const progress = purchaseProgress(p);
          const next = progress.next;
          const isOpen = !!expanded[p.id];
          const toggle = () => setExpanded(prev => ({ ...prev, [p.id]: !prev[p.id] }));
          const overdue = next && next.due_date < today();
          const wallet = accountName(p.account_id);
          return (
            <div key={p.id} className="card-soft p-4" data-testid={`purchase-${p.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-[#1A1C1A]" style={{ fontFamily: "Outfit" }}>{p.description}</div>
                  <div className="text-xs text-[#6B7068]">
                    {tr("{count}× · total {amount}", { count: p.installments, amount: fmtMoney(p.total_amount, cur) })}
                    {wallet ? ` · ${wallet}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => openEdit(p)} aria-label={tr("Editar")} data-testid={`purchase-edit-${p.id}`}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#061B4A]">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setConfirmDel(p)} aria-label={tr("Excluir")} data-testid={`purchase-delete-${p.id}`}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-[#6B7068] hover:bg-rose-50 hover:text-[#D9453B]">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-[#6B7068]">
                <span>{tr("{paid} de {total} pagas", { paid: progress.paidCount, total: progress.total })}</span>
                <span>{tr("faltam {amount}", { amount: fmtMoney(progress.pendingAmount, cur) })}</span>
              </div>
              <ProgressBar value={progress.paidCount} total={progress.total} className="mt-1.5" />

              {next ? (
                <div className={`mt-3 flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${overdue ? "bg-red-50" : "bg-[#F1EFE7]"}`}
                  data-testid={`purchase-summary-${p.id}`}>
                  <div className="min-w-0 text-sm">
                    <div className="font-medium text-[#1A1C1A]">
                      {tr("Parcela {number}/{total}", { number: next.number, total: next.total })} · {fmtMoney(next.amount, cur)}
                    </div>
                    <div className={`flex items-center gap-1 text-xs ${overdue ? "text-[#D9453B] font-medium" : "text-[#6B7068]"}`}>
                      <CalendarClock size={12} />
                      {overdue
                        ? tr("Atrasada desde {date}", { date: fmtDate(next.due_date) })
                        : tr("Vence {date}", { date: fmtDate(next.due_date) })}
                    </div>
                  </div>
                  <button type="button" onClick={() => setConfirmPay({ parcel: next, purchase: p })}
                    data-testid={`purchase-pay-next-${p.id}`}
                    className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl bg-[#061B4A] px-3 text-sm font-medium text-white hover:bg-[#1268F4]">
                    <Check size={14} /> {tr("Pagar")}
                  </button>
                </div>
              ) : (
                <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700" data-testid={`purchase-summary-${p.id}`}>
                  {tr("Tudo pago! 🎉")}
                </div>
              )}

              <button onClick={toggle} aria-expanded={isOpen} data-testid={`purchase-toggle-${p.id}`}
                className="mt-2 inline-flex min-h-[40px] items-center gap-1 text-xs font-medium text-[#6B7068] hover:text-[#1A1C1A]">
                {isOpen ? tr("Ocultar parcelas") : tr("Ver todas as parcelas")}
                <ChevronDown size={14} className={isOpen ? "rotate-180" : ""} />
              </button>

              {isOpen && (
                <div className="mt-1 divide-y divide-[#E5E4E0] rounded-xl border border-[#E5E4E0]">
                  {p.installments_list.map(i => {
                    const late = i.status !== "paid" && i.due_date < today();
                    return (
                      <div key={i.id} className="flex items-center justify-between gap-3 px-3 py-2" data-testid={`installment-row-${i.id}`}>
                        <div className="min-w-0 text-sm">
                          <div className="text-[#1A1C1A]">{tr("Parcela {number}/{total}", { number: i.number, total: i.total })}</div>
                          <div className={`text-xs ${late ? "text-[#D9453B]" : "text-[#6B7068]"}`}>{fmtDate(i.due_date)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="money-value text-sm font-semibold text-[#1A1C1A]">{fmtMoney(i.amount, cur)}</span>
                          <button type="button" onClick={() => setConfirmPay({ parcel: i, purchase: p })}
                            data-testid={`installment-${i.id}`}
                            aria-label={i.status === "paid" ? tr("Marcar como pendente") : tr("Confirmar pagamento")}
                            className={`flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 text-xs font-medium ${
                              i.status === "paid"
                                ? "bg-emerald-50 text-emerald-700"
                                : "border border-[#E5E4E0] text-[#6B7068] hover:bg-[#F1EFE7]"
                            }`}>
                            {i.status === "paid" ? <><Check size={12} /> {tr("Pago")}</> : tr("Pagar")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tr("Editar parcelamento")}</DialogTitle></DialogHeader>
          <form onSubmit={submitEdit} className="space-y-3">
            <div><Label>{tr("Descrição")}</Label>
              <Input value={editForm.description} required data-testid="purchase-edit-description"
                onChange={e => setEditForm({ ...editForm, description: e.target.value })} /></div>
            <div><Label>{tr("Forma de pagamento")}</Label>
              <Input value={editForm.payment_method} data-testid="purchase-edit-payment"
                onChange={e => setEditForm({ ...editForm, payment_method: e.target.value })} /></div>
            <div><Label>{tr("Categoria")}</Label>
              <Select value={editForm.category_id} onValueChange={v => setEditForm({ ...editForm, category_id: v })}>
                <SelectTrigger data-testid="purchase-edit-category"><SelectValue placeholder={tr("Selecione")} /></SelectTrigger>
                <SelectContent>
                  {cats.map(c => <SelectItem key={c.id} value={c.id}>{tr(c.name)}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label>{tr("Carteira")}</Label>
              <Select value={editForm.account_id} onValueChange={v => setEditForm({ ...editForm, account_id: v })}>
                <SelectTrigger data-testid="purchase-edit-account"><SelectValue placeholder={tr("Selecione a carteira")} /></SelectTrigger>
                <SelectContent>
                  {accs.filter(a => (a.currency || curr) === editForm.currency).map(a => (
                    <SelectItem key={a.id} value={a.id}>{tr(a.name)} ({a.currency || curr})</SelectItem>
                  ))}
                </SelectContent>
              </Select></div>
            <p className="text-xs text-[#6B7068]">{tr("Para alterar valor total ou número de parcelas, exclua e crie um novo parcelamento.")}</p>
            <Button type="submit" className="min-h-[44px] w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl" data-testid="purchase-edit-submit">{tr("Salvar alterações")}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmPay}
        onOpenChange={(v) => !v && setConfirmPay(null)}
        variant="primary"
        title={confirmPay?.parcel.status === "paid" ? tr("Reabrir parcela?") : tr("Confirmar pagamento?")}
        description={confirmPay ? (
          confirmPay.parcel.status === "paid"
            ? tr("A parcela {number}/{total} ({amount}) volta a ficar pendente e o valor retorna ao saldo da carteira.", {
              number: confirmPay.parcel.number, total: confirmPay.parcel.total,
              amount: fmtMoney(confirmPay.parcel.amount, confirmPay.purchase.currency || curr),
            })
            : tr("{amount} da parcela {number}/{total} de \"{name}\" sairá de {wallet}.", {
              number: confirmPay.parcel.number, total: confirmPay.parcel.total, name: confirmPay.purchase.description,
              amount: fmtMoney(confirmPay.parcel.amount, confirmPay.purchase.currency || curr),
              wallet: accountName(confirmPay.purchase.account_id) || tr("nenhuma carteira"),
            })
        ) : ""}
        confirmLabel={confirmPay?.parcel.status === "paid" ? tr("Reabrir") : tr("Confirmar pagamento")}
        onConfirm={togglePay}
        testId="installment-confirm-pay"
      />

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title={tr("Excluir parcelamento?")}
        description={confirmDel ? tr("\"{name}\" e todas as {count} parcelas serão removidas. Esta ação não pode ser desfeita.", { name: confirmDel.description, count: confirmDel.installments }) : ""}
        onConfirm={removePurchase}
        testId="purchase-confirm-delete"
      />
    </div>
  );
}
