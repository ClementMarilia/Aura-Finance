import { useEffect, useState } from "react";
import api, { CURRENCIES, fmtMoney, fmtDate, formatApiError, postCreate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import AmountInput from "@/components/AmountInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Target, Plus, Pencil, Trash2, PiggyBank, Banknote } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/ConfirmDialog";

import { translate as tr } from "@/i18n";
const emptyForm = { title: "", target_amount: "", current_amount: "", deadline: "", color: "#061B4A", account_id: "", currency: "EUR" };

export default function Goals() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [goals, setGoals] = useState([]);
  const [accs, setAccs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [contribFor, setContribFor] = useState(null);
  const [contribAmt, setContribAmt] = useState("");
  const [contribFrom, setContribFrom] = useState("");
  const [withdrawFor, setWithdrawFor] = useState(null);
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");

  const load = () => api.get("/goals", {
    params: currencyFilter ? { currency: currencyFilter } : {},
  }).then(r => setGoals(r.data || []));
  useEffect(() => { api.get("/accounts").then(r => setAccs(r.data || [])); }, []);
  useEffect(() => {
    api.get("/goals", {
      params: currencyFilter ? { currency: currencyFilter } : {},
    }).then(r => setGoals(r.data || []));
  }, [currencyFilter]);

  const openNew = () => { setEditing(null); setForm({ ...emptyForm, currency: curr }); setOpen(true); };
  const openEdit = (g) => {
    setEditing(g);
    setForm({ title: g.title, target_amount: g.target_amount, current_amount: g.current_amount,
      deadline: g.deadline || "", color: g.color || "#061B4A", account_id: g.account_id || "",
      currency: g.currency || curr });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = {
      title: form.title,
      target_amount: parseFloat(form.target_amount) || 0,
      current_amount: parseFloat(form.current_amount) || 0,
      deadline: form.deadline || null,
      color: form.color,
      account_id: form.account_id || null,
      currency: form.currency,
    };
    try {
      if (editing) { await api.put(`/goals/${editing.id}`, payload); toast.success(tr("Meta atualizada")); }
      else { await postCreate("/goals", payload); toast.success(tr("Meta criada")); }
      setOpen(false);
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    await api.delete(`/goals/${confirmDel.id}`);
    setConfirmDel(null);
    toast.success(tr("Meta excluída"));
    load();
  };

  const openContribute = (g) => { setContribFor(g); setContribAmt(""); setContribFrom(""); };

  const contribute = async (e) => {
    e.preventDefault();
    const amount = parseFloat(contribAmt);
    if (!amount || amount <= 0) return;
    try {
      await api.post(`/goals/${contribFor.id}/contribute`, {
        amount, from_account_id: contribFrom || null,
      });
      toast.success(`${fmtMoney(amount, contribFor.currency || curr)} adicionado à meta${contribFrom ? " (lançamento criado)" : ""}`);
      setContribFor(null);
      setContribAmt("");
      setContribFrom("");
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const openWithdraw = (g) => { setWithdrawFor(g); setWithdrawAmt(""); setWithdrawTo(""); };

  const withdraw = async (e) => {
    e.preventDefault();
    const amount = parseFloat(withdrawAmt);
    if (!amount || amount <= 0) return;
    try {
      await api.post(`/goals/${withdrawFor.id}/withdraw`, {
        amount, to_account_id: withdrawTo || null,
      });
      toast.success(`${fmtMoney(amount, withdrawFor.currency || curr)} resgatado da meta${withdrawTo ? " (lançamento criado)" : ""}`);
      setWithdrawFor(null);
      setWithdrawAmt("");
      setWithdrawTo("");
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="space-y-6" data-testid="goals-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Metas Financeiras")}</h1>
          <p className="text-[#6B7068]">{tr("Defina objetivos e acompanhe seu progresso")}</p>
        </div>
        <Button onClick={openNew} data-testid="goal-new-btn" className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
          <Plus size={16} className="mr-1" /> {tr("Nova meta")}
        </Button>
      </div>

      <div className="flex justify-end">
        <select value={currencyFilter} onChange={event => setCurrencyFilter(event.target.value)}
          data-testid="goal-currency-filter" className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
          <option value="">{tr("Todas as moedas")}</option>
          {CURRENCIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>

      {goals.length === 0 && (
        <div className="card-soft text-center py-16 flex flex-col items-center gap-3 text-[#6B7068]" data-testid="goals-empty">
          <Target size={32} className="opacity-40" />
          <span>{tr("Nenhuma meta ainda. Crie sua primeira meta de economia!")}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {goals.map(g => {
          const pct = g.target_amount > 0 ? Math.min(100, Math.round(g.current_amount / g.target_amount * 100)) : 0;
          const done = pct >= 100;
          return (
            <div key={g.id} className="card-soft" data-testid={`goal-${g.id}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white"
                    style={{ backgroundColor: g.color }}>
                    <Target size={18} />
                  </div>
                  <div>
                    <div className="font-semibold">{g.title}</div>
                    {g.deadline && <div className="text-xs text-[#6B7068]">até {fmtDate(g.deadline)}</div>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(g)} data-testid={`goal-edit-${g.id}`}
                    className="p-1.5 rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#061B4A]"><Pencil size={14} /></button>
                  <button onClick={() => setConfirmDel(g)} data-testid={`goal-delete-${g.id}`}
                    className="p-1.5 rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#D9453B]"><Trash2 size={14} /></button>
                </div>
              </div>

              <div className="mt-4 flex items-baseline justify-between">
                <span className="text-2xl font-semibold" style={{ fontFamily: "Outfit" }}>{fmtMoney(g.current_amount, g.currency || curr)}</span>
                <span className="text-sm text-[#6B7068]">de {fmtMoney(g.target_amount, g.currency || curr)}</span>
              </div>
              <div className="mt-2 h-2.5 bg-[#F1EFE7] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: done ? "#2C7A51" : g.color }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className={`text-xs font-medium ${done ? "text-emerald-600" : "text-[#6B7068]"}`}>{done ? tr("Concluída! 🎉") : `${pct}%`}</span>
                <div className="flex items-center gap-1">
                  {g.current_amount > 0 && (
                    <button onClick={() => openWithdraw(g)} data-testid={`goal-withdraw-${g.id}`}
                      className="text-xs text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#061B4A] rounded-lg px-2 py-1 flex items-center gap-1 font-medium">
                      <Banknote size={13} /> {tr("Resgatar")}
                    </button>
                  )}
                  <button onClick={() => openContribute(g)} data-testid={`goal-contribute-${g.id}`}
                    className="text-xs text-[#061B4A] hover:bg-[#F1EFE7] rounded-lg px-2 py-1 flex items-center gap-1 font-medium">
                    <PiggyBank size={13} /> {tr("Aportar")}
                  </button>
                </div>
              </div>
              {!done && (
                <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                  g.behind_schedule ? "bg-amber-50 text-amber-800" : "bg-[#F8F7F3] text-[#6B7068]"
                }`}>
                  {g.forecast_date ? (
                    <>
                      <div>
                        {tr("Previsão de conclusão: {date}", {
                          date: fmtDate(g.forecast_date),
                        })}
                      </div>
                      <div className="mt-0.5">
                        {tr("Ritmo médio: {amount} por mês", {
                          amount: fmtMoney(g.monthly_pace || 0, g.currency || curr),
                        })}
                      </div>
                      {g.behind_schedule && (
                        <div className="mt-1 font-medium">{tr("A previsão atual ultrapassa o prazo da meta.")}</div>
                      )}
                    </>
                  ) : (
                    <div>{tr("Faça pelo menos dois aportes para gerar uma previsão.")}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Outfit" }}>{editing ? "Editar meta" : tr("Nova meta")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-3">
            <div>
              <Label>{tr("Título")}</Label>
              <Input value={form.title} required data-testid="goal-title-input"
                onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Ex: Viagem, Reserva de emergência" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tr("Valor alvo")}</Label>
                <AmountInput value={form.target_amount} currency={form.currency || curr} required data-testid="goal-target-input"
                  onValueChange={target_amount => setForm({ ...form, target_amount })} />
              </div>
              <div>
                <Label>{tr("Já guardado")}</Label>
                <AmountInput value={form.current_amount} currency={form.currency || curr} data-testid="goal-current-input"
                  onValueChange={current_amount => setForm({ ...form, current_amount })} />
              </div>
            </div>
            <div>
              <Label>{tr("Moeda")}</Label>
              <Select disabled={!!editing && Number(editing.current_amount || 0) !== 0}
                value={form.currency} onValueChange={value => setForm({
                  ...form,
                  currency: value,
                  account_id: accs.some(account => account.id === form.account_id && (account.currency || curr) === value)
                    ? form.account_id : "",
                })}>
                <SelectTrigger data-testid="goal-currency-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {!!editing && Number(editing.current_amount || 0) !== 0 && (
                <p className="text-xs text-[#6B7068] mt-1">{tr("A moeda não pode ser alterada depois do primeiro aporte.")}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tr("Prazo (opcional)")}</Label>
                <Input type="date" value={form.deadline} data-testid="goal-deadline-input"
                  onChange={e => setForm({ ...form, deadline: e.target.value })} />
              </div>
              <div>
                <Label>{tr("Cor")}</Label>
                <Input type="color" value={form.color} className="w-16 h-10 p-1" data-testid="goal-color-input"
                  onChange={e => setForm({ ...form, color: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>{tr("Conta vinculada (opcional)")}</Label>
              <Select value={form.account_id || "none"} onValueChange={(v) => {
                const account = accs.find(item => item.id === v);
                setForm({
                  ...form,
                  account_id: v === "none" ? "" : v,
                  currency: account?.currency || form.currency,
                });
              }}>
                <SelectTrigger data-testid="goal-account-select"><SelectValue placeholder={tr("Nenhuma")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{tr("Nenhuma")}</SelectItem>
                  {accs.filter(a => (a.currency || curr) === form.currency).map(a => (
                    <SelectItem key={a.id} value={a.id}>{tr(a.name)} ({a.currency || curr})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-[#6B7068] mt-1">{tr("Aportes podem virar uma transferência para esta conta.")}</p>
            </div>
            <DialogFooter>
              <Button type="submit" data-testid="goal-save-btn" className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">{tr("Salvar")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Contribute dialog */}
      <Dialog open={!!contribFor} onOpenChange={(v) => !v && setContribFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Outfit" }}>Aportar em "{contribFor?.title}"</DialogTitle>
          </DialogHeader>
          <form onSubmit={contribute} className="space-y-3">
            <div>
              <Label>{tr("Valor do aporte")}</Label>
              <AmountInput autoFocus value={contribAmt} currency={contribFor?.currency || curr} required data-testid="goal-contrib-input"
                onValueChange={setContribAmt} />
            </div>
            <div>
              <Label>{tr("Debitar da conta (opcional)")}</Label>
              <Select value={contribFrom || "none"} onValueChange={(v) => setContribFrom(v === "none" ? "" : v)}>
                <SelectTrigger data-testid="goal-contrib-account"><SelectValue placeholder={tr("Não criar lançamento")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{tr("Não criar lançamento")}</SelectItem>
                  {accs.filter(a => (a.currency || curr) === (contribFor?.currency || curr)).map(a => (
                    <SelectItem key={a.id} value={a.id}>{tr(a.name)} ({a.currency || curr})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-[#6B7068] mt-1">
                {contribFrom && contribFor?.account_id && contribFrom !== contribFor?.account_id
                  ? tr("Cria uma transferência para a conta vinculada.")
                  : contribFrom ? "Cria uma despesa nesta conta." : "Apenas registra o progresso da meta."}
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" data-testid="goal-contrib-save" className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">{tr("Adicionar")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Withdraw dialog */}
      <Dialog open={!!withdrawFor} onOpenChange={(v) => !v && setWithdrawFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Outfit" }}>Resgatar de "{withdrawFor?.title}"</DialogTitle>
          </DialogHeader>
          <form onSubmit={withdraw} className="space-y-3">
            <div>
              <Label>{tr("Valor do resgate")}</Label>
              <AmountInput autoFocus value={withdrawAmt} currency={withdrawFor?.currency || curr} required data-testid="goal-withdraw-input"
                onValueChange={setWithdrawAmt} />
              <p className="text-xs text-[#6B7068] mt-1">{tr("Disponível:")} {fmtMoney(withdrawFor?.current_amount || 0, withdrawFor?.currency || curr)}</p>
            </div>
            <div>
              <Label>{tr("Creditar na conta (opcional)")}</Label>
              <Select value={withdrawTo || "none"} onValueChange={(v) => setWithdrawTo(v === "none" ? "" : v)}>
                <SelectTrigger data-testid="goal-withdraw-account"><SelectValue placeholder={tr("Não criar lançamento")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{tr("Não criar lançamento")}</SelectItem>
                  {accs.filter(a => (a.currency || curr) === (withdrawFor?.currency || curr)).map(a => (
                    <SelectItem key={a.id} value={a.id}>{tr(a.name)} ({a.currency || curr})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-[#6B7068] mt-1">
                {withdrawTo && withdrawFor?.account_id && withdrawTo !== withdrawFor?.account_id
                  ? tr("Cria uma transferência da conta vinculada de volta.")
                  : withdrawTo ? "Cria uma receita nesta conta." : "Apenas reduz o progresso da meta."}
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" data-testid="goal-withdraw-save" className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">{tr("Resgatar")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title={tr("Excluir meta?")}
        description={confirmDel ? tr("\"{name}\" será removida permanentemente.", { name: confirmDel.title }) : ""}
        onConfirm={remove}
        testId="goal-confirm-delete"
      />
    </div>
  );
}
