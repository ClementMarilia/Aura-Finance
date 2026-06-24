import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState({ name: "", color: "#1E3F33" });

  const load = () => api.get("/categories").then(r => setCats(r.data));
  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post("/categories", { ...form, kind: "expense" });
      toast.success("Categoria criada");
      setForm({ name: "", color: "#1E3F33" }); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const remove = async (cid) => {
    if (!window.confirm("Excluir categoria?")) return;
    await api.delete(`/categories/${cid}`); load();
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="settings-page">
      <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Configurações</h1>

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
              <button onClick={() => remove(c.id)} className="text-[#6B7068] hover:text-[#D9453B]" data-testid={`cat-delete-${c.id}`}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
