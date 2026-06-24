import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/ConfirmDialog";

const NOTIF_LABELS = {
  shared_expense_added: { title: "Despesas compartilhadas", desc: "Quando você é adicionado a uma nova despesa." },
  settlement_paid: { title: "Acertos recebidos", desc: "Quando alguém marca um valor como pago a você." },
  nudge: { title: "Lembretes (cutucadas)", desc: "Quando alguém te lembra de uma dívida pendente." },
  group_added: { title: "Grupos", desc: "Quando você é adicionado a um grupo." },
};

export default function Settings() {
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState({ name: "", color: "#1E3F33" });
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [prefs, setPrefs] = useState(null);

  const load = () => api.get("/categories").then(r => setCats(r.data));
  const loadPrefs = () => api.get("/notifications/preferences").then(r => setPrefs(r.data));
  useEffect(() => { load(); loadPrefs(); }, []);

  const togglePref = async (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      await api.put("/notifications/preferences", { prefs: next });
    } catch (err) {
      toast.error(formatApiError(err));
      loadPrefs();
    }
  };

  const add = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/categories/${editing.id}`, { ...form, kind: editing.kind || "expense" });
        toast.success("Categoria atualizada");
      } else {
        await api.post("/categories", { ...form, kind: "expense" });
        toast.success("Categoria criada");
      }
      setForm({ name: "", color: "#1E3F33" });
      setEditing(null);
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    await api.delete(`/categories/${confirmDel.id}`);
    setConfirmDel(null);
    toast.success("Categoria excluída");
    load();
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="settings-page">
      <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Configurações</h1>

      <div className="card-soft" data-testid="notif-prefs-section">
        <h3 className="text-lg font-semibold mb-1" style={{ fontFamily: "Outfit" }}>Notificações</h3>
        <p className="text-sm text-[#6B7068] mb-4">Escolha quais alertas você quer receber.</p>
        <div className="space-y-3">
          {Object.entries(NOTIF_LABELS).map(([key, { title, desc }]) => (
            <div key={key} className="flex items-center justify-between gap-4 p-3 border border-[#E5E4E0] rounded-xl">
              <div>
                <div className="text-sm font-medium text-[#1A1C1A]">{title}</div>
                <div className="text-xs text-[#6B7068]">{desc}</div>
              </div>
              <Switch
                data-testid={`notif-pref-${key}`}
                className="data-[state=checked]:bg-[#1E3F33] data-[state=unchecked]:bg-[#D6D3CA]"
                checked={prefs ? prefs[key] !== false : true}
                onCheckedChange={(v) => togglePref(key, v)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card-soft">
        <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "Outfit" }}>Categorias</h3>
        <form onSubmit={add} className="flex flex-wrap gap-2 items-end mb-4">
          <div className="flex-1 min-w-[160px]">
            <Label>Nome</Label>
            <Input value={form.name} required data-testid="settings-cat-name"
              onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Cor</Label>
            <Input type="color" value={form.color} className="w-16 h-10 p-1" data-testid="settings-cat-color"
              onChange={e => setForm({ ...form, color: e.target.value })} />
          </div>
          <Button type="submit" data-testid="settings-add-cat" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">
            <Plus size={16} className="mr-1" /> Adicionar
          </Button>
        </form>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {cats.map(c => (
            <div key={c.id} className="flex items-center justify-between p-3 border border-[#E5E4E0] rounded-xl">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                <span>{c.name}</span>
                {c.is_default && <span className="text-xs text-[#6B7068]">(padrão)</span>}
              </div>
              <button onClick={() => setConfirmDel(c)} className="text-[#6B7068] hover:text-[#D9453B]" data-testid={`cat-delete-${c.id}`}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title="Excluir categoria?"
        description={confirmDel ? `"${confirmDel.name}" será removida. Lançamentos existentes não serão afetados.` : ""}
        onConfirm={remove}
        testId="cat-confirm-delete"
      />
    </div>
  );
}
