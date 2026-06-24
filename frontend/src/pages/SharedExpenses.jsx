import { useEffect, useState } from "react";
import api, { fmtMoney, fmtDate, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Trash2, UserPlus, X, Check, Pencil } from "lucide-react";
import { toast } from "sonner";

function Initials({ name, color, size = 28 }) {
  const initials = (name || "?").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="rounded-full flex items-center justify-center text-white text-xs font-medium"
      style={{ width: size, height: size, backgroundColor: color || "#1E3F33" }}>
      {initials}
    </div>
  );
}

const emptyForm = (user) => ({
  title: "", amount: "", date: new Date().toISOString().slice(0, 10),
  category: "Mercado", payer_id: user?.id || "", split_type: "equal", group_id: "", notes: "",
});

export default function SharedExpenses() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [list, setList] = useState([]);
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // expense being edited or null
  const [participants, setParticipants] = useState([]);
  const [searchEmail, setSearchEmail] = useState("");
  const [form, setForm] = useState(emptyForm(user));
  const [confirmDelete, setConfirmDelete] = useState(null); // expense id

  const load = () => api.get("/shared-expenses").then(r => setList(r.data));
  useEffect(() => { load(); api.get("/groups").then(r => setGroups(r.data)); }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm(user));
    setParticipants([{ user, amount: "", percent: "" }]);
    setOpen(true);
  };

  const openEdit = (e) => {
    setEditing(e);
    setForm({
      title: e.title, amount: String(e.amount), date: e.date,
      category: e.category, payer_id: e.payer_id, split_type: e.split_type,
      group_id: e.group_id || "", notes: e.notes || "",
    });
    setParticipants(e.participants.map(p => ({
      user: p.user, amount: p.owed ? String(p.owed) : "", percent: "",
    })));
    setOpen(true);
  };

  const addParticipantByEmail = async () => {
    if (!searchEmail) return;
    try {
      const r = await api.get("/users/search", { params: { email: searchEmail } });
      if (!r.data) { toast.error("Usuário não encontrado"); return; }
      if (participants.some(p => p.user.id === r.data.id)) { toast.warning("Já adicionado"); return; }
      setParticipants([...participants, { user: r.data, amount: "", percent: "" }]);
      setSearchEmail("");
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const removeParticipant = (id) => setParticipants(participants.filter(p => p.user.id !== id));

  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = {
        title: form.title, amount: parseFloat(form.amount), date: form.date,
        category: form.category, payer_id: form.payer_id, split_type: form.split_type,
        group_id: form.group_id || null, notes: form.notes,
        participants: participants.map(p => ({
          user_id: p.user.id,
          amount: p.amount ? parseFloat(p.amount) : null,
          percent: p.percent ? parseFloat(p.percent) : null,
        })),
      };
      if (editing) {
        await api.put(`/shared-expenses/${editing.id}`, body);
        toast.success("Despesa atualizada");
      } else {
        await api.post("/shared-expenses", body);
        toast.success("Despesa compartilhada criada");
      }
      setOpen(false); setEditing(null); setParticipants([]);
      setForm(emptyForm(user));
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const togglePaid = async (sid, uid) => { await api.post(`/shared-expenses/${sid}/settle/${uid}`); load(); };

  const doDelete = async () => {
    try {
      await api.delete(`/shared-expenses/${confirmDelete.id}`);
      toast.success("Despesa excluída");
      setConfirmDelete(null);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
      setConfirmDelete(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="shared-expenses-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Despesas Compartilhadas</h1>
          <p className="text-[#6B7068]">Apenas você e os participantes podem ver cada despesa</p>
        </div>
        <Button onClick={openNew} data-testid="new-shared-button"
          className="bg-[#D96C5B] hover:bg-[#C25848] text-white rounded-xl">
          <Plus size={16} className="mr-1" /> Nova despesa
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setParticipants([]); } }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar despesa compartilhada" : "Nova despesa compartilhada"}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Título</Label>
                <Input value={form.title} required data-testid="shared-title-input"
                  onChange={e => setForm({ ...form, title: e.target.value })} /></div>
              <div><Label>Valor total</Label>
                <Input type="number" step="0.01" value={form.amount} required data-testid="shared-amount-input"
                  onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div><Label>Data</Label>
                <Input type="date" value={form.date} required data-testid="shared-date-input"
                  onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div><Label>Categoria</Label>
                <Input value={form.category} data-testid="shared-category-input"
                  onChange={e => setForm({ ...form, category: e.target.value })} /></div>
              <div><Label>Grupo (opcional)</Label>
                <Select value={form.group_id} onValueChange={v => setForm({ ...form, group_id: v })}>
                  <SelectTrigger data-testid="shared-group-select"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select></div>
            </div>

            <div>
              <Label>Participantes</Label>
              <div className="flex gap-2 mt-1.5">
                <Input type="email" placeholder="email@exemplo.com" value={searchEmail}
                  onChange={e => setSearchEmail(e.target.value)} data-testid="shared-add-email-input" />
                <Button type="button" onClick={addParticipantByEmail} data-testid="shared-add-participant-button"
                  className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl"><UserPlus size={16} /></Button>
              </div>
              <div className="mt-3 space-y-2">
                {participants.map(p => (
                  <div key={p.user.id} className="flex items-center gap-2 p-2 bg-[#F1EFE7] rounded-lg">
                    <Initials name={p.user.name} color={p.user.avatar_color} />
                    <div className="flex-1 text-sm">
                      <div className="font-medium">{p.user.name}</div>
                      <div className="text-xs text-[#6B7068]">{p.user.email}</div>
                    </div>
                    {form.split_type === "manual" && (
                      <Input type="number" step="0.01" placeholder="valor" className="w-24"
                        value={p.amount}
                        onChange={e => setParticipants(participants.map(x => x.user.id === p.user.id ? { ...x, amount: e.target.value } : x))} />
                    )}
                    {form.split_type === "percent" && (
                      <Input type="number" step="0.01" placeholder="%" className="w-20"
                        value={p.percent}
                        onChange={e => setParticipants(participants.map(x => x.user.id === p.user.id ? { ...x, percent: e.target.value } : x))} />
                    )}
                    {p.user.id !== user.id && (
                      <button type="button" onClick={() => removeParticipant(p.user.id)} className="text-[#6B7068] hover:text-[#D9453B]">
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tipo de divisão</Label>
                <Select value={form.split_type} onValueChange={v => setForm({ ...form, split_type: v })}>
                  <SelectTrigger data-testid="shared-split-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equal">Igual entre todos</SelectItem>
                    <SelectItem value="manual">Valor manual</SelectItem>
                    <SelectItem value="percent">Percentual</SelectItem>
                  </SelectContent>
                </Select></div>
              <div><Label>Quem pagou</Label>
                <Select value={form.payer_id} onValueChange={v => setForm({ ...form, payer_id: v })}>
                  <SelectTrigger data-testid="shared-payer-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {participants.map(p => <SelectItem key={p.user.id} value={p.user.id}>{p.user.name}</SelectItem>)}
                  </SelectContent>
                </Select></div>
            </div>

            <Button type="submit" className="w-full bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl" data-testid="shared-submit-button">
              {editing ? "Salvar alterações" : "Criar despesa"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
        title="Excluir despesa?"
        description={confirmDelete ? `"${confirmDelete.title}" - ${fmtMoney(confirmDelete.amount, curr)}. Esta ação não pode ser desfeita.` : ""}
        onConfirm={doDelete}
        testId="shared-confirm-delete"
      />

      <div className="space-y-4">
        {list.length === 0 && <div className="card-soft text-center text-[#6B7068]">Nenhuma despesa compartilhada</div>}
        {list.map(e => {
          const canEdit = e.creator_id === user.id;
          const canDelete = e.creator_id === user.id || e.payer_id === user.id;
          return (
            <div key={e.id} className="card-soft" data-testid={`shared-${e.id}`}>
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>{e.title}</span>
                    <span className={`pill ${e.status === "finalized" ? "pill-paid" : e.status === "partial" ? "pill-pending" : "pill-cancelled"}`}>
                      {e.status === "finalized" ? "Finalizada" : e.status === "partial" ? "Parcialmente acertada" : "Aberta"}
                    </span>
                  </div>
                  <div className="text-sm text-[#6B7068]">
                    {e.category} · {fmtDate(e.date)} · pago por <strong>{e.payer?.name}</strong>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="text-right">
                    <div className="text-2xl font-semibold" style={{ fontFamily: "Outfit" }}>{fmtMoney(e.amount, curr)}</div>
                  </div>
                  <div className="flex gap-1">
                    {canEdit && (
                      <button onClick={() => openEdit(e)} data-testid={`shared-edit-${e.id}`}
                        className="p-2 rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#1E3F33] border border-[#E5E4E0]"
                        title="Editar">
                        <Pencil size={16} />
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => setConfirmDelete(e)} data-testid={`shared-delete-${e.id}`}
                        className="p-2 rounded-lg text-[#6B7068] hover:bg-rose-50 hover:text-[#D9453B] border border-[#E5E4E0]"
                        title="Excluir">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {e.participants.map(p => {
                  const isPayer = p.user_id === e.payer_id;
                  return (
                    <div key={p.user_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#F1EFE7]">
                      <Initials name={p.user?.name} color={p.user?.avatar_color} />
                      <div className="flex-1 text-sm">
                        <div className="font-medium">{p.user?.name}{isPayer && <span className="ml-2 text-xs text-emerald-600">(pagador)</span>}</div>
                        <div className="text-xs text-[#6B7068]">
                          {isPayer ? "Não deve nada" : (p.paid_back ? "Pago" : `Deve ${fmtMoney(p.owed, curr)} para ${e.payer?.name}`)}
                        </div>
                      </div>
                      {!isPayer && (
                        <button onClick={() => togglePaid(e.id, p.user_id)} data-testid={`settle-${e.id}-${p.user_id}`}
                          className={`px-3 py-1.5 rounded-lg text-xs ${
                            p.paid_back
                              ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              : "bg-[#1E3F33] text-white hover:bg-[#2C5C4A]"
                          }`}>
                          {p.paid_back ? <><Check size={12} className="inline mr-1" />Pago</> : "Marcar pago"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
