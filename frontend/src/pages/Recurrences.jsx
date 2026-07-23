import { useEffect, useState } from "react";
import api, { fmtMoney, fmtDate, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Repeat, Plus, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/ConfirmDialog";

const FREQ_LABEL = { weekly: "Semanal", monthly: "Mensal", yearly: "Anual" };

const emptyForm = {
  type: "expense", amount: "", category_id: "", account_id: "", payment_method: "",
  description: "", frequency: "monthly", next_run: new Date().toISOString().slice(0, 10), active: true,
};

export default function Recurrences() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [accs, setAccs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [expanded, setExpanded] = useState({});

  const load = () => api.get("/recurrences").then(r => setItems(r.data || []));
  useEffect(() => {
    load();
    api.get("/categories").then(r => setCats(r.data));
    api.get("/accounts").then(r => setAccs(r.data || []));
  }, []);

  const FACTOR = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, yearly: 1 / 12 };
  const monthly = (type) => items
    .filter(r => r.active && r.type === type)
    .reduce((s, r) => s + r.amount * (FACTOR[r.frequency] || 1), 0);
  const fixedExpense = monthly("expense");
  const fixedIncome = monthly("income");

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (r) => {
    setEditing(r);
    setForm({
      type: r.type, amount: String(r.amount), category_id: r.category_id || "",
      account_id: r.account_id || "",
      payment_method: r.payment_method || "", description: r.description || "",
      frequency: r.frequency, next_run: r.next_run, active: r.active,
    });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = {
      type: form.type, amount: parseFloat(form.amount) || 0,
      category_id: form.category_id || null, account_id: form.account_id || null,
      payment_method: form.payment_method || null,
      description: form.description, frequency: form.frequency,
      next_run: form.next_run, active: form.active,
    };
    try {
      if (editing) { await api.put(`/recurrences/${editing.id}`, payload); toast.success("Recorrência atualizada"); }
      else { await api.post("/recurrences", payload); toast.success("Recorrência criada"); }
      setOpen(false);
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const toggle = async (r) => {
    await api.post(`/recurrences/${r.id}/toggle`);
    load();
  };

  const remove = async () => {
    if (!confirmDel) return;
    await api.delete(`/recurrences/${confirmDel.id}`);
    setConfirmDel(null);
    toast.success("Recorrência excluída");
    load();
  };

  return (
    <div className="space-y-6" data-testid="recurrences-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Recorrências</h1>
          <p className="text-[#6B7068]">Lançamentos automáticos (aluguel, salário, assinaturas...)</p>
        </div>
        <Button onClick={openNew} data-testid="rec-new-btn" className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
          <Plus size={16} className="mr-1" /> Nova recorrência
        </Button>
      </div>

      {items.some(r => r.active) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="rec-summary">
          <div className="card-soft">
            <div className="text-sm text-[#6B7068]">Gasto fixo mensal (média)</div>
            <div className="text-2xl font-semibold text-rose-600 mt-1" style={{ fontFamily: "Outfit" }} data-testid="rec-fixed-expense">
              {fmtMoney(fixedExpense, curr)}
            </div>
          </div>
          <div className="card-soft">
            <div className="text-sm text-[#6B7068]">Receita fixa mensal (média)</div>
            <div className="text-2xl font-semibold text-emerald-600 mt-1" style={{ fontFamily: "Outfit" }} data-testid="rec-fixed-income">
              {fmtMoney(fixedIncome, curr)}
            </div>
          </div>
          <div className="card-soft">
            <div className="text-sm text-[#6B7068]">Saldo fixo estimado</div>
            <div className={`text-2xl font-semibold mt-1 ${fixedIncome - fixedExpense >= 0 ? "text-[#061B4A]" : "text-rose-600"}`} style={{ fontFamily: "Outfit" }} data-testid="rec-fixed-balance">
              {fmtMoney(fixedIncome - fixedExpense, curr)}
            </div>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="card-soft text-center py-16 flex flex-col items-center gap-3 text-[#6B7068]" data-testid="rec-empty">
          <Repeat size={32} className="opacity-40" />
          <span>Nenhuma recorrência. Automatize seus lançamentos fixos!</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(r => {
          const cat = cats.find(c => c.id === r.category_id);
          const isOpen = !!expanded[r.id];
          const toggleOpen = () => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }));
          return (
            <div key={r.id} className={`card-soft ${!r.active ? "opacity-60" : ""}`} data-testid={`rec-${r.id}`}>
              <div className="flex items-start justify-between">
                <button onClick={toggleOpen} data-testid={`rec-toggle-card-${r.id}`} className="flex items-center gap-2 text-left flex-1">
                  <span className="text-[#6B7068]">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white ${r.type === "income" ? "bg-emerald-600" : "bg-[#D96C5B]"}`}>
                    <Repeat size={18} />
                  </div>
                  <div>
                    <div className="font-semibold">{r.description || (r.type === "income" ? "Receita" : "Despesa")}</div>
                    <div className="text-xs text-[#6B7068]">{FREQ_LABEL[r.frequency]} · próx: {fmtDate(r.next_run)}</div>
                  </div>
                </button>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(r)} data-testid={`rec-edit-${r.id}`} className="p-1.5 rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#061B4A]"><Pencil size={14} /></button>
                  <button onClick={() => setConfirmDel(r)} data-testid={`rec-delete-${r.id}`} className="p-1.5 rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#D9453B]"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className={`text-2xl font-semibold ${r.type === "income" ? "text-emerald-600" : "text-rose-600"}`} style={{ fontFamily: "Outfit" }}>
                  {r.type === "income" ? "+" : "-"}{fmtMoney(r.amount, r.currency || curr)}
                </span>
                <span className={`text-xs ${r.active ? "text-emerald-700" : "text-[#6B7068]"}`}>{r.active ? "Ativa" : "Pausada"}</span>
              </div>
              {isOpen && (
              <div className="mt-3 border-t border-[#E5E4E0] pt-3 space-y-2" data-testid={`rec-details-${r.id}`}>
                {cat && <div className="text-xs inline-flex items-center gap-1.5 text-[#6B7068]"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />{cat.name}</div>}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#6B7068]">{r.active ? "Pausar" : "Ativar"} recorrência</span>
                  <Switch data-testid={`rec-toggle-${r.id}`} className="data-[state=checked]:bg-[#061B4A] data-[state=unchecked]:bg-[#D6D3CA]"
                    checked={r.active} onCheckedChange={() => toggle(r)} />
                </div>
              </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle style={{ fontFamily: "Outfit" }}>{editing ? "Editar recorrência" : "Nova recorrência"}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="rec-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Despesa</SelectItem>
                    <SelectItem value="income">Receita</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Frequência</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                  <SelectTrigger data-testid="rec-freq-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="quarterly">Trimestral</SelectItem>
                    <SelectItem value="semiannual">Semestral</SelectItem>
                    <SelectItem value="yearly">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor</Label>
                <Input type="number" step="0.01" value={form.amount} required data-testid="rec-amount-input"
                  onChange={e => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <Label>Próxima data</Label>
                <Input type="date" value={form.next_run} required data-testid="rec-date-input"
                  onChange={e => setForm({ ...form, next_run: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Categoria</Label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger data-testid="rec-category-select"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Carteira (de onde sai/entra o valor)</Label>
              <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                <SelectTrigger data-testid="rec-account-select"><SelectValue placeholder="Selecione a carteira" /></SelectTrigger>
                <SelectContent>
                  {accs.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={form.description} data-testid="rec-description-input"
                onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Ex: Aluguel, Salário, Spotify" />
            </div>
            <DialogFooter>
              <Button type="submit" data-testid="rec-save-btn" className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title="Excluir recorrência?"
        description={confirmDel ? `"${confirmDel.description || "Recorrência"}" não gerará mais lançamentos e os lançamentos FUTUROS já gerados por ela serão removidos. Os lançamentos passados permanecem.` : ""}
        onConfirm={remove}
        testId="rec-confirm-delete"
      />
    </div>
  );
}
