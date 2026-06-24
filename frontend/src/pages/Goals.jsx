import { useEffect, useState } from "react";
import api, { fmtMoney, fmtDate, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Target, Plus, Pencil, Trash2, PiggyBank } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/ConfirmDialog";

const emptyForm = { title: "", target_amount: "", current_amount: "", deadline: "", color: "#1E3F33", account_id: "" };

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

  const load = () => api.get("/goals").then(r => setGoals(r.data || []));
  useEffect(() => { load(); api.get("/accounts").then(r => setAccs(r.data || [])); }, []);

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (g) => {
    setEditing(g);
    setForm({ title: g.title, target_amount: g.target_amount, current_amount: g.current_amount,
      deadline: g.deadline || "", color: g.color || "#1E3F33", account_id: g.account_id || "" });
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
    };
    try {
      if (editing) { await api.put(`/goals/${editing.id}`, payload); toast.success("Meta atualizada"); }
      else { await api.post("/goals", payload); toast.success("Meta criada"); }
      setOpen(false);
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    await api.delete(`/goals/${confirmDel.id}`);
    setConfirmDel(null);
    toast.success("Meta excluída");
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
      toast.success(`${fmtMoney(amount, curr)} adicionado à meta${contribFrom ? " (lançamento criado)" : ""}`);
      setContribFor(null);
      setContribAmt("");
      setContribFrom("");
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="space-y-6" data-testid="goals-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Metas Financeiras</h1>
          <p className="text-[#6B7068]">Defina objetivos e acompanhe seu progresso</p>
        </div>
        <Button onClick={openNew} data-testid="goal-new-btn" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">
          <Plus size={16} className="mr-1" /> Nova meta
        </Button>
      </div>

      {goals.length === 0 && (
        <div className="card-soft text-center py-16 flex flex-col items-center gap-3 text-[#6B7068]" data-testid="goals-empty">
          <Target size={32} className="opacity-40" />
          <span>Nenhuma meta ainda. Crie sua primeira meta de economia!</span>
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
                    className="p-1.5 rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#1E3F33]"><Pencil size={14} /></button>
                  <button onClick={() => setConfirmDel(g)} data-testid={`goal-delete-${g.id}`}
                    className="p-1.5 rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#D9453B]"><Trash2 size={14} /></button>
                </div>
              </div>

              <div className="mt-4 flex items-baseline justify-between">
                <span className="text-2xl font-semibold" style={{ fontFamily: "Outfit" }}>{fmtMoney(g.current_amount, curr)}</span>
                <span className="text-sm text-[#6B7068]">de {fmtMoney(g.target_amount, curr)}</span>
              </div>
              <div className="mt-2 h-2.5 bg-[#F1EFE7] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: done ? "#2C7A51" : g.color }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className={`text-xs font-medium ${done ? "text-emerald-600" : "text-[#6B7068]"}`}>{done ? "Concluída! 🎉" : `${pct}%`}</span>
                <button onClick={() => openContribute(g)} data-testid={`goal-contribute-${g.id}`}
                  className="text-xs text-[#1E3F33] hover:bg-[#F1EFE7] rounded-lg px-2 py-1 flex items-center gap-1 font-medium">
                  <PiggyBank size={13} /> Aportar
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Outfit" }}>{editing ? "Editar meta" : "Nova meta"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-3">
            <div>
              <Label>Título</Label>
              <Input value={form.title} required data-testid="goal-title-input"
                onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Ex: Viagem, Reserva de emergência" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor alvo</Label>
                <Input type="number" step="0.01" value={form.target_amount} required data-testid="goal-target-input"
                  onChange={e => setForm({ ...form, target_amount: e.target.value })} />
              </div>
              <div>
                <Label>Já guardado</Label>
                <Input type="number" step="0.01" value={form.current_amount} data-testid="goal-current-input"
                  onChange={e => setForm({ ...form, current_amount: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Prazo (opcional)</Label>
                <Input type="date" value={form.deadline} data-testid="goal-deadline-input"
                  onChange={e => setForm({ ...form, deadline: e.target.value })} />
              </div>
              <div>
                <Label>Cor</Label>
                <Input type="color" value={form.color} className="w-16 h-10 p-1" data-testid="goal-color-input"
                  onChange={e => setForm({ ...form, color: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Conta vinculada (opcional)</Label>
              <Select value={form.account_id || "none"} onValueChange={(v) => setForm({ ...form, account_id: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="goal-account-select"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {accs.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-[#6B7068] mt-1">Aportes podem virar uma transferência para esta conta.</p>
            </div>
            <DialogFooter>
              <Button type="submit" data-testid="goal-save-btn" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">Salvar</Button>
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
              <Label>Valor do aporte</Label>
              <Input type="number" step="0.01" autoFocus value={contribAmt} required data-testid="goal-contrib-input"
                onChange={e => setContribAmt(e.target.value)} />
            </div>
            <div>
              <Label>Debitar da conta (opcional)</Label>
              <Select value={contribFrom || "none"} onValueChange={(v) => setContribFrom(v === "none" ? "" : v)}>
                <SelectTrigger data-testid="goal-contrib-account"><SelectValue placeholder="Não criar lançamento" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não criar lançamento</SelectItem>
                  {accs.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-[#6B7068] mt-1">
                {contribFrom && contribFor?.account_id && contribFrom !== contribFor?.account_id
                  ? "Cria uma transferência para a conta vinculada."
                  : contribFrom ? "Cria uma despesa nesta conta." : "Apenas registra o progresso da meta."}
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" data-testid="goal-contrib-save" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">Adicionar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title="Excluir meta?"
        description={confirmDel ? `"${confirmDel.title}" será removida permanentemente.` : ""}
        onConfirm={remove}
        testId="goal-confirm-delete"
      />
    </div>
  );
}
