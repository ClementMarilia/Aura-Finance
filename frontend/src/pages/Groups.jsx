import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Trash2, UserPlus, Pencil, X, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

function Initials({ name, color, size = 32 }) {
  const initials = (name || "?").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="rounded-full flex items-center justify-center text-white text-xs font-medium"
      style={{ width: size, height: size, backgroundColor: color || "#061B4A" }}>
      {initials}
    </div>
  );
}

export default function Groups() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", member_emails: "" });
  const [addEmail, setAddEmail] = useState({});
  const [confirmDel, setConfirmDel] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", description: "" });
  const [expanded, setExpanded] = useState({});

  const load = () => api.get("/groups").then(r => setList(r.data));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/groups", {
        name: form.name,
        description: form.description,
        member_emails: form.member_emails.split(",").map(s => s.trim()).filter(Boolean),
      });
      toast.success("Grupo criado");
      setOpen(false); setForm({ name: "", description: "", member_emails: "" }); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const addMember = async (gid) => {
    const em = addEmail[gid];
    if (!em) return;
    try {
      await api.post(`/groups/${gid}/members`, { email: em });
      toast.success("Membro adicionado");
      setAddEmail({ ...addEmail, [gid]: "" }); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const openEdit = (g) => { setEditing(g); setEditForm({ name: g.name, description: g.description || "" }); };
  const submitEdit = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/groups/${editing.id}`, editForm);
      toast.success("Grupo atualizado"); setEditing(null); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };
  const removeMember = async (gid, uid, name) => {
    if (!window.confirm(`Remover ${name} do grupo?`)) return;
    try { await api.delete(`/groups/${gid}/members/${uid}`); toast.success("Removido"); load(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    try {
      await api.delete(`/groups/${confirmDel.id}`);
      setConfirmDel(null);
      toast.success("Grupo excluído");
      load();
    } catch (err) {
      setConfirmDel(null);
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="space-y-6" data-testid="groups-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Grupos</h1>
          <p className="text-[#6B7068]">Casa, Viagem, Mercado, Restaurante, Projeto…</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-group-button" className="bg-[#D96C5B] hover:bg-[#C25848] text-white rounded-xl">
              <Plus size={16} className="mr-1" /> Novo grupo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo grupo</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>Nome</Label>
                <Input value={form.name} required data-testid="group-name-input"
                  onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Descrição</Label>
                <Textarea value={form.description} data-testid="group-description-input"
                  onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div><Label>Membros (e-mails separados por vírgula)</Label>
                <Input value={form.member_emails} data-testid="group-emails-input"
                  onChange={e => setForm({ ...form, member_emails: e.target.value })}
                  placeholder="ana@exemplo.com, lucas@exemplo.com" /></div>
              <Button type="submit" className="w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl" data-testid="group-submit-button">Criar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {list.length === 0 && <div className="card-soft text-center text-[#6B7068] md:col-span-2">Nenhum grupo</div>}
        {list.map(g => {
          const isOpen = !!expanded[g.id];
          const toggle = () => setExpanded(prev => ({ ...prev, [g.id]: !prev[g.id] }));
          return (
          <div key={g.id} className="card-soft" data-testid={`group-${g.id}`}>
            <div className="flex items-start justify-between">
              <button onClick={toggle} data-testid={`group-toggle-${g.id}`} className="flex items-start gap-2 text-left flex-1">
                <span className="mt-1 text-[#6B7068]">{isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                <div>
                  <div className="text-xl font-semibold" style={{ fontFamily: "Outfit" }}>{g.name}</div>
                  <div className="text-sm text-[#6B7068] mt-1">{g.description || "—"}</div>
                  {!isOpen && (
                    <div className="text-xs text-[#6B7068] mt-1 flex items-center gap-1" data-testid={`group-summary-${g.id}`}>
                      {g.members.slice(0, 4).map(m => <Initials key={m.id} name={m.name} color={m.avatar_color} size={20} />)}
                      <span className="ml-1">{g.members.length} membro(s)</span>
                    </div>
                  )}
                </div>
              </button>
              <div className="flex gap-1">
                <button onClick={() => openEdit(g)} className="text-[#6B7068] hover:text-[#061B4A] p-1" data-testid={`group-edit-${g.id}`} title="Editar">
                  <Pencil size={16} />
                </button>
                <button onClick={() => setConfirmDel(g)} className="text-[#6B7068] hover:text-[#D9453B] p-1" data-testid={`group-delete-${g.id}`} title="Excluir">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {isOpen && (
            <>
            <div className="mt-4">
              <div className="text-xs text-[#6B7068] mb-2">{g.members.length} membro(s)</div>
              <div className="flex flex-wrap gap-2">
                {g.members.map(m => (
                  <div key={m.id} className="flex items-center gap-2 bg-[#F1EFE7] rounded-full pl-1 pr-3 py-1">
                    <Initials name={m.name} color={m.avatar_color} size={24} />
                    <span className="text-xs">{m.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Input placeholder="adicionar por e-mail" type="email"
                value={addEmail[g.id] || ""}
                onChange={e => setAddEmail({ ...addEmail, [g.id]: e.target.value })}
                data-testid={`group-add-email-${g.id}`} />
              <Button type="button" onClick={() => addMember(g.id)} data-testid={`group-add-member-${g.id}`}
                className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl"><UserPlus size={16} /></Button>
            </div>
            </>
            )}
          </div>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar grupo</DialogTitle></DialogHeader>
          <form onSubmit={submitEdit} className="space-y-3">
            <div><Label>Nome</Label>
              <Input value={editForm.name} required onChange={e => setEditForm({ ...editForm, name: e.target.value })} data-testid="group-edit-name" /></div>
            <div><Label>Descrição</Label>
              <Textarea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} data-testid="group-edit-desc" /></div>
            <Button type="submit" className="w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl" data-testid="group-edit-submit">Salvar alterações</Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title="Excluir grupo?"
        description={confirmDel ? `"${confirmDel.name}" será removido. As despesas vinculadas a este grupo permanecem visíveis aos participantes.` : ""}
        onConfirm={remove}
        testId="group-confirm-delete"
      />
    </div>
  );
}
