import { useEffect, useState } from "react";
import api, { fmtMoney, fmtDate, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Check, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

export default function Receivables() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [list, setList] = useState([]);
  const [accs, setAccs] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ person: "", amount: "", due_date: new Date().toISOString().slice(0, 10), description: "", account_id: "" });
  const [confirmDel, setConfirmDel] = useState(null);

  const load = () => api.get("/receivables").then(r => setList(r.data));
  useEffect(() => { load(); api.get("/accounts").then(r => setAccs(r.data || [])); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ person: "", amount: "", due_date: new Date().toISOString().slice(0, 10), description: "", account_id: "" });
    setOpen(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    setForm({ person: r.person, amount: String(r.amount), due_date: r.due_date, description: r.description || "", account_id: r.account_id || "" });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = { ...form, amount: parseFloat(form.amount), account_id: form.account_id || null };
      if (editing) {
        await api.put(`/receivables/${editing.id}`, body);
        toast.success("Atualizado");
      } else {
        await api.post("/receivables", body);
        toast.success("Conta a receber criada");
      }
      setOpen(false); setEditing(null);
      setForm({ person: "", amount: "", due_date: new Date().toISOString().slice(0, 10), description: "", account_id: "" });
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const receive = async (id) => {
    try {
      const r = await api.post(`/receivables/${id}/receive`);
      toast.success(r.data?.status === "received" ? "Recebido! Receita lançada na carteira" : "Recebimento desfeito");
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };
  const remove = async () => {
    if (!confirmDel) return;
    await api.delete(`/receivables/${confirmDel.id}`);
    setConfirmDel(null);
    toast.success("Conta excluída");
    load();
  };

  return (
    <div className="space-y-6" data-testid="receivables-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Contas a Receber</h1>
          <p className="text-[#6B7068]">Valores que você tem a receber</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={openNew} data-testid="new-receivable-button" className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl">
              <Plus size={16} className="mr-1" /> Nova conta a receber
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Editar conta a receber" : "Nova conta a receber"}</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>Pessoa / Empresa</Label>
                <Input value={form.person} required data-testid="rec-person-input"
                  onChange={e => setForm({ ...form, person: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Valor</Label>
                  <Input type="number" step="0.01" value={form.amount} required data-testid="rec-amount-input"
                    onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
                <div><Label>Data prevista</Label>
                  <Input type="date" value={form.due_date} required data-testid="rec-date-input"
                    onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
              </div>
              <div><Label>Descrição</Label>
                <Input value={form.description} data-testid="rec-description-input"
                  onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div><Label>Carteira (onde o valor será creditado ao receber)</Label>
                <Select value={form.account_id} onValueChange={v => setForm({ ...form, account_id: v })}>
                  <SelectTrigger data-testid="rec-account-select"><SelectValue placeholder="Selecione a carteira" /></SelectTrigger>
                  <SelectContent>
                    {accs.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select></div>
              <Button type="submit" className="w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl" data-testid="rec-submit-button">
                {editing ? "Salvar alterações" : "Salvar"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="card-soft overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-[#F1EFE7] text-[#6B7068]">
            <tr>
              <th className="text-left py-3 px-4">Pessoa / Empresa</th>
              <th className="text-left py-3 px-4">Descrição</th>
              <th className="text-left py-3 px-4">Vencimento</th>
              <th className="text-left py-3 px-4">Status</th>
              <th className="text-right py-3 px-4">Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-[#6B7068]">Nenhum registro</td></tr>}
            {list.map(r => (
              <tr key={r.id} className="border-b border-[#E5E4E0]" data-testid={`rec-row-${r.id}`}>
                <td className="py-3 px-4 font-medium">{r.person}</td>
                <td className="py-3 px-4">{r.description || "—"}</td>
                <td className="py-3 px-4">{fmtDate(r.due_date)}</td>
                <td className="py-3 px-4">
                  <span className={`pill ${r.status === "received" ? "pill-paid" : "pill-pending"}`}>
                    {r.status === "received" ? "Recebido" : "Pendente"}
                  </span>
                </td>
                <td className="py-3 px-4 text-right font-semibold">{fmtMoney(r.amount, r.currency || curr)}</td>
                <td className="py-3 px-4 flex gap-1 justify-end">
                  <button onClick={() => receive(r.id)} className="text-emerald-600 hover:text-emerald-800 p-1" data-testid={`rec-receive-${r.id}`} title="Marcar como recebido">
                    <Check size={16} />
                  </button>
                  <button onClick={() => openEdit(r)} className="text-[#6B7068] hover:text-[#061B4A] p-1" data-testid={`rec-edit-${r.id}`} title="Editar">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setConfirmDel(r)} className="text-[#6B7068] hover:text-[#D9453B] p-1" data-testid={`rec-delete-${r.id}`} title="Excluir">
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
        title="Excluir conta a receber?"
        description={confirmDel ? `"${confirmDel.person}" - ${fmtMoney(confirmDel.amount, confirmDel.currency || curr)}. Esta ação não pode ser desfeita.` : ""}
        onConfirm={remove}
        testId="rec-confirm-delete"
      />
    </div>
  );
}
