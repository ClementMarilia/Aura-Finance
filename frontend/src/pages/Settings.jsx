import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/ConfirmDialog";

const NOTIF_LABELS = {
  shared_expense_added: { title: "Despesas compartilhadas", desc: "Quando você é adicionado a uma nova despesa." },
  settlement_paid: { title: "Acertos recebidos", desc: "Quando alguém marca um valor como pago a você." },
  nudge: { title: "Lembretes (cutucadas)", desc: "Quando alguém te lembra de uma dívida pendente." },
  group_added: { title: "Grupos", desc: "Quando você é adicionado a um grupo." },
};

const KIND_LABEL = { expense: "Despesa", income: "Receita", both: "Ambos" };
const KIND_BADGE = {
  expense: "bg-rose-50 text-rose-700",
  income: "bg-emerald-50 text-emerald-700",
  both: "bg-[#F1EFE7] text-[#1E3F33]",
};

const defaultCatForm = () => ({ name: "", color: "#1E3F33", kind: "expense" });

export default function Settings() {
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState(defaultCatForm());
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [tab, setTab] = useState("expense"); // expense | income | both

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

  const startEdit = (c) => {
    setEditing(c);
    setForm({ name: c.name, color: c.color || "#1E3F33", kind: c.kind || "expense" });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(defaultCatForm());
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: form.name.trim(),
        color: form.color,
        kind: form.kind,
      };
      if (!payload.name) {
        toast.error("Nome é obrigatório");
        return;
      }
      if (editing) {
        await api.put(`/categories/${editing.id}`, payload);
        toast.success("Categoria atualizada");
      } else {
        await api.post("/categories", payload);
        toast.success("Categoria criada");
      }
      cancelEdit();
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

  const filteredCats = cats.filter(c => {
    const k = c.kind || "expense";
    return k === tab;
  });

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
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>Categorias</h3>
          <p className="text-xs text-[#6B7068]">Crie categorias para Receitas (ex: Salário) e Despesas (ex: Gasolina).</p>
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end mb-4" data-testid="cat-form">
          <div className="sm:col-span-5">
            <Label>Nome</Label>
            <Input value={form.name} required data-testid="settings-cat-name"
              placeholder="Ex: Salário, Gasolina, Mercado"
              onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="sm:col-span-3">
            <Label>Tipo</Label>
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
              <SelectTrigger data-testid="settings-cat-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Despesa</SelectItem>
                <SelectItem value="income">Receita</SelectItem>
                <SelectItem value="both">Ambos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Cor</Label>
            <Input type="color" value={form.color} className="w-full h-10 p-1" data-testid="settings-cat-color"
              onChange={e => setForm({ ...form, color: e.target.value })} />
          </div>
          <div className="sm:col-span-2 flex gap-1">
            <Button type="submit" data-testid="settings-add-cat" className="flex-1 bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">
              {editing ? <Pencil size={16} className="mr-1" /> : <Plus size={16} className="mr-1" />}
              {editing ? "Salvar" : "Adicionar"}
            </Button>
            {editing && (
              <Button type="button" variant="outline" onClick={cancelEdit} data-testid="settings-cancel-edit" className="rounded-xl">
                <X size={16} />
              </Button>
            )}
          </div>
        </form>

        {/* Tabs por tipo */}
        <div className="flex gap-1 mb-3 border-b border-[#E5E4E0]" data-testid="cat-tabs">
          {[
            { key: "expense", label: "Despesas" },
            { key: "income", label: "Receitas" },
            { key: "both", label: "Ambos" },
          ].map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              data-testid={`cat-tab-${t.key}`}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition ${
                tab === t.key
                  ? "border-[#1E3F33] text-[#1E3F33]"
                  : "border-transparent text-[#6B7068] hover:text-[#1E3F33]"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-[#6B7068]">
                ({cats.filter(c => (c.kind || "expense") === t.key).length})
              </span>
            </button>
          ))}
        </div>

        {filteredCats.length === 0 ? (
          <div className="text-sm text-[#6B7068] py-8 text-center">
            Nenhuma categoria de {KIND_LABEL[tab].toLowerCase()} criada ainda.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {filteredCats.map(c => {
              const kind = c.kind || "expense";
              return (
                <div key={c.id} className="flex items-center justify-between p-3 border border-[#E5E4E0] rounded-xl" data-testid={`cat-row-${c.id}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                    <span className="truncate">{c.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${KIND_BADGE[kind]}`}>
                      {KIND_LABEL[kind]}
                    </span>
                    {c.is_default && <span className="text-xs text-[#6B7068]">(padrão)</span>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(c)} className="text-[#6B7068] hover:text-[#1E3F33] p-1" data-testid={`cat-edit-${c.id}`} title="Editar">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setConfirmDel(c)} className="text-[#6B7068] hover:text-[#D9453B] p-1" data-testid={`cat-delete-${c.id}`} title="Excluir">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
