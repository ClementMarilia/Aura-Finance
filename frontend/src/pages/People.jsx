import { useEffect, useState } from "react";
import api, { formatApiError, postCreate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { translate as tr } from "@/i18n";

const emptyForm = {
  name: "",
  nickname: "",
  relationship: "",
  notes: "",
};

export default function People() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => api.get("/people").then(response => setItems(response.data));
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (person) => {
    setEditing(person);
    setForm({
      name: person.name || "",
      nickname: person.nickname || "",
      relationship: person.relationship || "",
      notes: person.notes || "",
    });
    setOpen(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/people/${editing.id}`, form);
        toast.success(tr("Pessoa atualizada"));
      } else {
        await postCreate("/people", form);
        toast.success(tr("Pessoa adicionada"));
      }
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/people/${confirmDelete.id}`);
      toast.success(tr("Pessoa excluída"));
      setConfirmDelete(null);
      await load();
    } catch (error) {
      toast.error(formatApiError(error));
      setConfirmDelete(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="people-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{tr("Pessoas")}</h1>
          <p className="text-[#6B7068] mt-1">
            {tr("Cadastre referências privadas para organizar despesas e relatórios. Ninguém recebe convite ou notificação.")}
          </p>
        </div>
        <Button
          onClick={openNew}
          className="bg-[#D96C5B] hover:bg-[#C25848] text-white rounded-xl"
          data-testid="new-person-button"
        >
          <Plus size={16} className="mr-1" /> {tr("Adicionar pessoa")}
        </Button>
      </div>

      <div className="card-soft border-emerald-200 bg-emerald-50/50 text-sm text-emerald-800">
        {tr("Este cadastro pertence somente a você. A pessoa não precisa ter conta nem saber que foi adicionada.")}
      </div>

      {items.length === 0 ? (
        <div className="card-soft text-center py-12 text-[#6B7068]">
          <UserRound size={32} className="mx-auto mb-3 opacity-60" />
          {tr("Nenhuma pessoa cadastrada")}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(person => (
            <div key={person.id} className="card-soft" data-testid={`person-${person.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-lg truncate">{person.name}</div>
                  {person.nickname && (
                    <div className="text-sm text-[#6B7068] truncate">{person.nickname}</div>
                  )}
                  {person.relationship && (
                    <span className="pill mt-2">{person.relationship}</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(person)}
                    className="p-2 rounded-lg border border-[#E5E4E0] text-[#6B7068] hover:bg-[#F1EFE7]"
                    title={tr("Editar")}
                    data-testid={`edit-person-${person.id}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(person)}
                    className="p-2 rounded-lg border border-[#E5E4E0] text-[#6B7068] hover:bg-rose-50 hover:text-rose-600"
                    title={tr("Excluir")}
                    data-testid={`delete-person-${person.id}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              {person.notes && (
                <p className="text-sm text-[#6B7068] mt-3 whitespace-pre-wrap">{person.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? tr("Editar pessoa") : tr("Adicionar pessoa")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>{tr("Nome")}</Label>
              <Input
                value={form.name}
                onChange={event => setForm({ ...form, name: event.target.value })}
                required
                maxLength={120}
                data-testid="person-name"
              />
            </div>
            <div>
              <Label>{tr("Apelido (opcional)")}</Label>
              <Input
                value={form.nickname}
                onChange={event => setForm({ ...form, nickname: event.target.value })}
                maxLength={120}
                data-testid="person-nickname"
              />
            </div>
            <div>
              <Label>{tr("Relação (opcional)")}</Label>
              <Input
                value={form.relationship}
                onChange={event => setForm({ ...form, relationship: event.target.value })}
                placeholder={tr("Família, amigo, colega...")}
                maxLength={80}
                data-testid="person-relationship"
              />
            </div>
            <div>
              <Label>{tr("Observações")}</Label>
              <textarea
                value={form.notes}
                onChange={event => setForm({ ...form, notes: event.target.value })}
                className="w-full min-h-24 bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm"
                maxLength={1000}
                data-testid="person-notes"
              />
            </div>
            <Button
              type="submit"
              disabled={saving}
              className="w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl"
              data-testid="person-submit"
            >
              {saving ? tr("Salvando...") : tr("Salvar")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={value => !value && setConfirmDelete(null)}
        title={tr("Excluir pessoa?")}
        description={tr("A exclusão só será permitida se não houver histórico financeiro relacionado.")}
        onConfirm={remove}
        testId="confirm-delete-person"
      />
    </div>
  );
}
