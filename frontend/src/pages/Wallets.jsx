import { useEffect, useState } from "react";
import api, { fmtMoney, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Pencil, Trash2, Wallet, PiggyBank, Banknote, CreditCard, TrendingUp, ArrowLeftRight } from "lucide-react";
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
  const [transferOpen, setTransferOpen] = useState(false);
  const emptyTransfer = {
    from_account_id: "", to_account_id: "", amount: "",
    date: new Date().toISOString().slice(0, 10), description: "",
  };
  const [transfer, setTransfer] = useState(emptyTransfer);

  const load = () => api.get("/accounts").then(r => setList(r.data || []));
  useEffect(() => { load(); }, []);

  const openTransfer = () => { setTransfer(emptyTransfer); setTransferOpen(true); };
  const doTransfer = async (e) => {
    e.preventDefault();
    if (!transfer.from_account_id || !transfer.to_account_id) {
      toast.error("Selecione as carteiras de origem e destino"); return;
    }
    if (transfer.from_account_id === transfer.to_account_id) {
      toast.error("Origem e destino devem ser diferentes"); return;
    }
    try {
      await api.post("/transactions", {
        type: "transfer",
        date: transfer.date,
        amount: parseFloat(transfer.amount) || 0,
        from_account_id: transfer.from_account_id,
        to_account_id: transfer.to_account_id,
        description: transfer.description || "Transferência entre carteiras",
        status: "paid",
      });
      toast.success("Transferência realizada");
      setTransferOpen(false); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

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
        <div className="flex gap-2">
          <Button onClick={openTransfer} data-testid="wallet-transfer-btn" variant="outline" className="rounded-xl border-[#1E3F33] text-[#1E3F33]">
            <ArrowLeftRight size={16} className="mr-1" /> Transferir
          </Button>
          <Button onClick={openNew} data-testid="wallet-new-btn" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">
            <Plus size={16} className="mr-1" /> Nova carteira
          </Button>
        </div>
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

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle style={{ fontFamily: "Outfit" }}>Transferir entre carteiras</DialogTitle></DialogHeader>
          <form onSubmit={doTransfer} className="space-y-3">
            <div>
              <Label>De (origem)</Label>
              <Select value={transfer.from_account_id} onValueChange={v => setTransfer({ ...transfer, from_account_id: v })}>
                <SelectTrigger data-testid="transfer-from-select"><SelectValue placeholder="Carteira de origem" /></SelectTrigger>
                <SelectContent>
                  {list.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({fmtMoney(a.balance || 0, curr)})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Para (destino)</Label>
              <Select value={transfer.to_account_id} onValueChange={v => setTransfer({ ...transfer, to_account_id: v })}>
                <SelectTrigger data-testid="transfer-to-select"><SelectValue placeholder="Carteira de destino" /></SelectTrigger>
                <SelectContent>
                  {list.filter(a => a.id !== transfer.from_account_id).map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({fmtMoney(a.balance || 0, curr)})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor</Label>
                <Input type="number" step="0.01" value={transfer.amount} required data-testid="transfer-amount-input"
                  onChange={e => setTransfer({ ...transfer, amount: e.target.value })} />
              </div>
              <div>
                <Label>Data</Label>
                <Input type="date" value={transfer.date} required data-testid="transfer-date-input"
                  onChange={e => setTransfer({ ...transfer, date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Descrição (opcional)</Label>
              <Input value={transfer.description} data-testid="transfer-description-input"
                onChange={e => setTransfer({ ...transfer, description: e.target.value })} placeholder="Ex: Sobra do mês para a poupança" />
            </div>
            <DialogFooter>
              <Button type="submit" data-testid="transfer-save-btn" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">Transferir</Button>
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
