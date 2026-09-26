import { useEffect, useState } from "react";
import api, { CURRENCIES, fmtMoney, fmtDate, formatApiError, postCreate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import AmountInput from "@/components/AmountInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Repeat, Plus, Trash2, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/ConfirmDialog";
import { defaultAccountFor } from "@/lib/accounts";

import { translate as tr } from "@/i18n";
import { useThemedColor } from "@/lib/colors";
const FREQ_LABEL = {
  weekly: tr("Semanal"),
  monthly: tr("Mensal"),
  quarterly: tr("Trimestral"),
  semiannual: tr("Semestral"),
  yearly: tr("Anual"),
};

// Average monthly weight of each frequency (a weekly bill happens ~4.33x a month).
const FACTOR = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, yearly: 1 / 12 };

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
  type: "expense", amount: "", category_id: "", person_id: "", account_id: "", payment_method: "",
  description: "", frequency: "monthly", next_run: today(), active: true,
  currency: "EUR",
};

export default function Recurrences() {
  const themed = useThemedColor();
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [accs, setAccs] = useState([]);
  const [people, setPeople] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [currencyFilter, setCurrencyFilter] = useState("");

  const load = () => api.get("/recurrences", {
    params: currencyFilter ? { currency: currencyFilter } : {},
  }).then(r => setItems(r.data || []));
  useEffect(() => {
    api.get("/categories").then(r => setCats(r.data));
    api.get("/accounts").then(r => setAccs(r.data || []));
    api.get("/reports/filter-options").then(r => {
      setPeople((r.data?.participants || []).filter(person => !person.self));
    });
  }, []);
  useEffect(() => {
    api.get("/recurrences", {
      params: currencyFilter ? { currency: currencyFilter } : {},
    }).then(r => setItems(r.data || []));
  }, [currencyFilter]);

  const monthly = (type) => items
    .filter(r => r.active && r.type === type)
    .reduce((s, r) => s + (r.base_amount ?? r.amount) * (FACTOR[r.frequency] || 1), 0);
  const fixedExpense = monthly("expense");
  const fixedIncome = monthly("income");

  // Active first, soonest next; paused ones at the end.
  const sorted = [...items].sort((a, b) => (
    (b.active - a.active) || String(a.next_run).localeCompare(String(b.next_run))
  ));
  const showCurrencyFilter = currencyFilter || new Set(items.map(r => r.currency || curr)).size > 1;
  const categoriesFor = (type) => cats.filter(c => (c.kind || "expense") === "both" || (c.kind || "expense") === type);

  const openNew = () => {
    // Recurrences generate paid entries on their own, so they must start on
    // a wallet (same rule as Lançamentos).
    const account = defaultAccountFor(accs, curr);
    setEditing(null);
    setForm({ ...emptyForm, next_run: today(), currency: account?.currency || curr, account_id: account?.id || "" });
    setOpen(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    setForm({
      type: r.type, amount: String(r.amount), category_id: r.category_id || "",
      person_id: r.person_id || "", account_id: r.account_id || "",
      payment_method: r.payment_method || "", description: r.description || "",
      frequency: r.frequency, next_run: r.next_run, active: r.active,
      currency: r.currency || curr,
    });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = {
      type: form.type, amount: parseFloat(form.amount) || 0,
      category_id: form.category_id || null, person_id: form.person_id || null,
      account_id: form.account_id || null,
      payment_method: form.payment_method || null,
      description: form.description, frequency: form.frequency,
      next_run: form.next_run, active: form.active,
      currency: form.currency,
    };
    try {
      if (editing) { await api.put(`/recurrences/${editing.id}`, payload); toast.success(tr("Recorrência atualizada")); }
      else { await postCreate("/recurrences", payload); toast.success(tr("Recorrência criada")); }
      setOpen(false);
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const toggle = async (r) => {
    try {
      const response = await api.post(`/recurrences/${r.id}/toggle`);
      toast.success(response.data?.active ? tr("Recorrência ativada") : tr("Recorrência pausada"));
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    try {
      await api.delete(`/recurrences/${confirmDel.id}`);
      toast.success(tr("Recorrência excluída"));
      setOpen(false);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setConfirmDel(null);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6" data-testid="recurrences-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Recorrências")}</h1>
          <p className="text-sm text-[#6B7068]">{tr("Lançamentos automáticos (aluguel, salário, assinaturas...)")}</p>
        </div>
        <Button onClick={openNew} data-testid="rec-new-btn" className="min-h-[44px] w-full sm:w-auto bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
          <Plus size={16} className="mr-1" /> {tr("Nova recorrência")}
        </Button>
      </div>
      {showCurrencyFilter && (
        <div className="flex justify-end">
          <select value={currencyFilter} onChange={event => setCurrencyFilter(event.target.value)}
            data-testid="rec-currency-filter" className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
            <option value="">{tr("Todas as moedas")}</option>
            {CURRENCIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
      )}

      {items.some(r => r.active) && (
        <div className="card-soft p-4" data-testid="rec-summary">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="stat-label">{tr("Receita fixa")}</div>
              <div className="money-value mt-1 text-base font-semibold text-emerald-600 sm:text-xl" style={{ fontFamily: "Outfit" }} data-testid="rec-fixed-income">
                {fmtMoney(fixedIncome, curr)}
              </div>
            </div>
            <div>
              <div className="stat-label">{tr("Gasto fixo")}</div>
              <div className="money-value mt-1 text-base font-semibold text-rose-600 sm:text-xl" style={{ fontFamily: "Outfit" }} data-testid="rec-fixed-expense">
                {fmtMoney(fixedExpense, curr)}
              </div>
            </div>
            <div className="text-right">
              <div className="stat-label">{tr("Sobra fixa")}</div>
              <div className={`money-value mt-1 text-base font-semibold sm:text-xl ${fixedIncome - fixedExpense >= 0 ? "text-[#061B4A]" : "text-rose-600"}`}
                style={{ fontFamily: "Outfit" }} data-testid="rec-fixed-balance">
                {fmtMoney(fixedIncome - fixedExpense, curr)}
              </div>
            </div>
          </div>
          <div className="mt-2 text-xs text-[#6B7068]">{tr("Média por mês das recorrências ativas")}</div>
        </div>
      )}

      {items.length === 0 && (
        <div className="card-soft text-center py-16 flex flex-col items-center gap-3 text-[#6B7068]" data-testid="rec-empty">
          <Repeat size={32} className="opacity-40" />
          <span>{tr("Nenhuma recorrência. Automatize seus lançamentos fixos!")}</span>
        </div>
      )}

      {items.length > 0 && (
        <div className="card-soft p-0 overflow-hidden">
          <div className="divide-y divide-[#E5E4E0]">
            {sorted.map(r => {
              const cat = cats.find(c => c.id === r.category_id);
              const income = r.type === "income";
              const Icon = income ? ArrowDownLeft : ArrowUpRight;
              return (
                <div key={r.id} className={`flex items-center gap-2 pr-3 ${!r.active ? "opacity-60" : ""}`} data-testid={`rec-${r.id}`}>
                  <button type="button" onClick={() => openEdit(r)} data-testid={`rec-edit-${r.id}`}
                    aria-label={tr("Editar {name}", { name: r.description || tr("Recorrência") })}
                    className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-[#F1EFE7] transition-colors">
                    <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${income ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[#1A1C1A]">
                        {r.description || (income ? tr("Receita") : tr("Despesa"))}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-[#6B7068]">
                        {cat && <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: themed(cat.color) }} />{tr(cat.name)} ·</span>}
                        <span>{FREQ_LABEL[r.frequency]}</span>
                        <span>·</span>
                        <span>{r.active ? tr("próxima {date}", { date: fmtDate(r.next_run) }) : tr("Pausada")}</span>
                      </span>
                    </span>
                    <span className={`money-value whitespace-nowrap font-semibold ${income ? "text-emerald-600" : "text-rose-600"}`}>
                      {income ? "+" : "-"}{fmtMoney(r.amount, r.currency || curr)}
                    </span>
                  </button>
                  <Switch data-testid={`rec-toggle-${r.id}`} className="data-[state=checked]:bg-[#061B4A] data-[state=unchecked]:bg-[#D6D3CA]"
                    aria-label={r.active ? tr("Pausar recorrência") : tr("Ativar recorrência")}
                    checked={r.active} onCheckedChange={() => toggle(r)} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader><DialogTitle style={{ fontFamily: "Outfit" }}>{editing ? tr("Editar recorrência") : tr("Nova recorrência")}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="min-w-0 space-y-3">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#F1EFE7] p-1" role="radiogroup" aria-label={tr("Tipo")} data-testid="rec-type-select">
              {[["expense", tr("Despesa")], ["income", tr("Receita")]].map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={form.type === value}
                  onClick={() => setForm({
                    ...form, type: value,
                    category_id: categoriesFor(value).some(c => c.id === form.category_id) ? form.category_id : "",
                  })}
                  data-testid={`rec-type-${value}`}
                  className={`min-h-[40px] rounded-lg text-sm transition ${form.type === value ? "bg-white font-medium text-[#061B4A] shadow-sm" : "text-[#6B7068]"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tr("Valor")}</Label>
                <AmountInput value={form.amount} currency={form.currency || curr} required data-testid="rec-amount-input"
                  onValueChange={amount => setForm({ ...form, amount })} />
              </div>
              <div>
                <Label>{tr("Próxima data")}</Label>
                <Input type="date" value={form.next_run} required data-testid="rec-date-input"
                  onChange={e => setForm({ ...form, next_run: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>{tr("Descrição")}</Label>
              <Input value={form.description} data-testid="rec-description-input"
                onChange={e => setForm({ ...form, description: e.target.value })} placeholder={tr("Ex: Aluguel, Salário, Spotify")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tr("Frequência")}</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                  <SelectTrigger data-testid="rec-freq-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(FREQ_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{tr("Categoria")}</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                  <SelectTrigger data-testid="rec-category-select"><SelectValue placeholder={tr("Selecione")} /></SelectTrigger>
                  <SelectContent>
                    {categoriesFor(form.type).map(c => <SelectItem key={c.id} value={c.id}>{tr(c.name)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>{tr("Carteira (de onde sai/entra o valor)")}</Label>
              <Select value={form.account_id} onValueChange={(v) => {
                const account = accs.find(item => item.id === v);
                setForm({ ...form, account_id: v, currency: account?.currency || form.currency || curr });
              }}>
                <SelectTrigger data-testid="rec-account-select"><SelectValue placeholder={tr("Selecione a carteira")} /></SelectTrigger>
                <SelectContent>
                  {accs.map(a => (
                    <SelectItem key={a.id} value={a.id}>{tr(a.name)} ({a.currency || curr})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tr("Pessoa (opcional)")}</Label>
                <Select
                  value={form.person_id || "__none"}
                  onValueChange={(value) => setForm({
                    ...form,
                    person_id: value === "__none" ? "" : value,
                  })}
                >
                  <SelectTrigger data-testid="rec-person-select">
                    <SelectValue placeholder={tr("Nenhuma pessoa")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{tr("Nenhuma pessoa")}</SelectItem>
                    {people.map(person => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name}{person.external ? ` · ${tr("externa")}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{tr("Moeda")}</Label>
                <Select value={form.currency} onValueChange={(value) => setForm({
                  ...form, currency: value,
                  account_id: accs.some(account => account.id === form.account_id && (account.currency || curr) === value)
                    ? form.account_id : "",
                })}>
                  <SelectTrigger data-testid="rec-currency-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-[#6B7068]">
              {form.frequency !== "weekly" && Number(form.next_run?.slice(8, 10)) > 28
                ? tr("Nos meses mais curtos, o lançamento cai no último dia do mês e volta ao dia {day} depois.", { day: Number(form.next_run.slice(8, 10)) })
                : tr("A pessoa será vinculada a cada lançamento gerado.")}
            </p>
            <DialogFooter className="grid grid-cols-2 gap-2 sm:flex sm:space-x-0">
              {editing && (
                <Button type="button" variant="outline" onClick={() => setConfirmDel(editing)} data-testid={`rec-delete-${editing.id}`}
                  className="min-h-[44px] rounded-xl text-[#D9453B] hover:text-[#D9453B]">
                  <Trash2 size={15} className="mr-1.5" /> {tr("Excluir")}
                </Button>
              )}
              <Button type="submit" data-testid="rec-save-btn" className={`min-h-[44px] bg-[#061B4A] hover:bg-[#1268F4] rounded-xl ${editing ? "" : "col-span-2"}`}>{tr("Salvar")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title={tr("Excluir recorrência?")}
        description={confirmDel ? tr("\"{name}\" não gerará mais lançamentos e os lançamentos FUTUROS já gerados por ela serão removidos. Os lançamentos passados permanecem.", { name: confirmDel.description || tr("Recorrência") }) : ""}
        onConfirm={remove}
        testId="rec-confirm-delete"
      />
    </div>
  );
}
