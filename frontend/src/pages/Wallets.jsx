import { useEffect, useState } from "react";
import api, { fmtMoney, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Pencil, Trash2, Wallet, PiggyBank, Banknote, CreditCard, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const TYPES = [
  { value: "checking", label: "Conta corrente", icon: Wallet },
  { value: "savings", label: "Poupança", icon: PiggyBank },
  { value: "cash", label: "Dinheiro", icon: Banknote },
  { value: "card", label: "Cartão", icon: CreditCard },
  { value: "investment", label: "Investimento", icon: TrendingUp },
  { value: "other", label: "Outro", icon: Wallet },
];
const typeMeta = (t) => TYPES.find(x => x.value === t) || TYPES[0];

const emptyForm = { name: "", type: "checking", initial_balance: "" };

export default function Wallets() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const load = () => api.get("/accounts").then(r => setList(r.data || []));
  useEffect(() => { load(); }, []);

  const total = list.reduce((s, a) => s + (a.balance || 0), 0);

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (a) => {
    setEditing(a);
    setForm({ name: a.name, type: a.type, initial_balance: String(a.initial_balance ?? 0) });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = { name: form.name, type: form.type, initial_balance: parseFloat(form.initial_balance) || 0 };
    try {
      if (editing) { await api.put(`/accounts/${editing.id}`, payload); toast.success("Carteira atualizada"); }
      else { await api.post("/accounts", payload); toast.success("Carteira criada"); }
      setOpen(false); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    await api.delete(`/accounts/${confirmDel.id}`);
    setConfirmDel(null);
    toast.success("Carteira excluída");
    load();
  };

  return (
    <div className="space-y-6" data-testid="wallets-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Carteiras</h1>
          <p className="text-[#6B7068]">Contas, poupança e investimentos — saldo usado para pagar contas</p>
        </div>
        <Button onClick={openNew} data-testid="wallet-new-btn" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">
          <Plus size={16} className="mr-1" /> Nova carteira
        </Button>
      </div>

      <div className="card-soft" data-testid="wallets-total">
        <div className="text-sm text-[#6B7068]">Saldo total disponível</div>
        <div className={`text-4xl font-semibold mt-1 ${total >= 0 ? "text-[#1E3F33]" : "text-rose-600"}`} style={{ fontFamily: "Outfit" }}>
          {fmtMoney(total, curr)}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map(a => {
          const meta = typeMeta(a.type);
          const Icon = meta.icon;
          return (
            <div key={a.id} className="card-soft" data-testid={`wallet-${a.id}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-[#E8EFE9] text-[#1E3F33] flex items-center justify-center"><Icon size={18} /></div>
                  <div>
                    <div className="font-semibold">{a.name}</div>
                    <div className="text-xs text-[#6B7068]">{meta.label}</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(a)} data-testid={`wallet-edit-${a.id}`} className="p-1.5 rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#1E3F33]"><Pencil size={14} /></button>
                  <button onClick={() => setConfirmDel(a)} data-testid={`wallet-delete-${a.id}`} className="p-1.5 rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#D9453B]"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="mt-4">
                <div className="text-sm text-[#6B7068]">Saldo atual</div>
                <div className={`text-2xl font-semibold ${a.balance >= 0 ? "text-[#1E3F33]" : "text-rose-600"}`} style={{ fontFamily: "Outfit" }} data-testid={`wallet-balance-${a.id}`}>
                  {fmtMoney(a.balance || 0, curr)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle style={{ fontFamily: "Outfit" }}>{editing ? "Editar carteira" : "Nova carteira"}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={form.name} required data-testid="wallet-name-input"
                onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Nubank, Poupança, Tesouro" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="wallet-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Saldo {editing ? "" : "inicial"}</Label>
                <Input type="number" step="0.01" value={form.initial_balance} data-testid="wallet-balance-input"
                  onChange={e => setForm({ ...form, initial_balance: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-[#6B7068]">Atualize aqui o valor guardado/investido. Pagamentos e transferências ajustam o saldo automaticamente.</p>
            <DialogFooter>
              <Button type="submit" data-testid="wallet-save-btn" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title="Excluir carteira?"
        description={confirmDel ? `"${confirmDel.name}" será removida. Os lançamentos vinculados permanecem.` : ""}
        onConfirm={remove}
        testId="wallet-confirm-delete"
      />
    </div>
  );
}
