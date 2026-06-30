import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { fmtMoney, fmtDate, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Trash2, UserPlus, X, Check, Pencil, ArrowRight, Scale } from "lucide-react";
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
  const [summary, setSummary] = useState([]); // {user, net}
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // expense being edited or null
  const [participants, setParticipants] = useState([]);
  const [searchEmail, setSearchEmail] = useState("");
  const [form, setForm] = useState(emptyForm(user));
  const [confirmDelete, setConfirmDelete] = useState(null); // expense id

  const load = async () => {
    const [a, b] = await Promise.all([
      api.get("/shared-expenses"),
      api.get("/settlements"),
    ]);
    setList(a.data);
    setSummary(b.data.summary || []);
  };
  useEffect(() => { load(); api.get("/groups").then(r => setGroups(r.data)); }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm(user));
    setParticipants([{ user, amount: "", percent: "" }]);
    setOpen(true);
  };

  // Quando seleciona um grupo, injeta automaticamente os membros como participantes
  const applyGroup = (groupId) => {
    setForm(prev => ({ ...prev, group_id: groupId }));
    if (!groupId) return;
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    setParticipants(prev => {
      const existing = new Map(prev.map(p => [p.user.id, p]));
      (g.members || []).forEach(m => {
        if (!existing.has(m.id)) existing.set(m.id, { user: m, amount: "", percent: "" });
      });
      // garante o próprio usuário sempre
      if (!existing.has(user.id)) existing.set(user.id, { user, amount: "", percent: "" });
      return Array.from(existing.values());
    });
  };

  // Preview de quanto cada um deve (somente UI, baseado nos valores do form)
  const previewSplit = () => {
    const total = parseFloat(form.amount) || 0;
    if (!total || participants.length === 0) return {};
    const out = {};
    if (form.split_type === "equal") {
      const share = +(total / participants.length).toFixed(2);
      participants.forEach((p, idx) => {
        // arredonda residual no último
        if (idx === participants.length - 1) {
          const sumSoFar = +(share * (participants.length - 1)).toFixed(2);
          out[p.user.id] = +(total - sumSoFar).toFixed(2);
        } else out[p.user.id] = share;
      });
    } else if (form.split_type === "manual") {
      participants.forEach(p => { out[p.user.id] = parseFloat(p.amount) || 0; });
    } else if (form.split_type === "percent") {
      participants.forEach(p => {
        const pct = parseFloat(p.percent) || 0;
        out[p.user.id] = +((total * pct) / 100).toFixed(2);
      });
    }
    return out;
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

  const togglePaid = async (sid, uid) => {
    try {
      const r = await api.post(`/shared-expenses/${sid}/settle/${uid}`);
      const isPaid = r.data?.paid_back;
      toast.success(isPaid ? "Acerto confirmado" : "Acerto reaberto");
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

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

      {/* Banner compacto de acertos pendentes (atalho para a página /acertos) */}
      {summary.length > 0 && (() => {
        const credits = summary.filter(s => s.net > 0);
        const debts = summary.filter(s => s.net < 0);
        return (
          <Link
            to="/acertos"
            data-testid="settle-summary-banner"
            className="card-soft block hover:bg-[#F8F6EE] transition py-3 px-4"
          >
            <div className="flex items-center gap-3 flex-wrap">
              <Scale size={16} className="text-[#1E3F33] flex-shrink-0" />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm flex-1 min-w-0">
                {credits.map(s => (
                  <span key={s.user?.id} className="text-emerald-700" data-testid={`banner-credit-${s.user?.id}`}>
                    <strong>{(s.user?.name || "").split(" ")[0]}</strong> te deve{" "}
                    <strong>{fmtMoney(s.net, curr)}</strong>
                  </span>
                ))}
                {debts.map(s => (
                  <span key={s.user?.id} className="text-rose-700" data-testid={`banner-debt-${s.user?.id}`}>
                    Você deve <strong>{fmtMoney(Math.abs(s.net), curr)}</strong>{" "}
                    para <strong>{(s.user?.name || "").split(" ")[0]}</strong>
                  </span>
                ))}
              </div>
              <span className="text-xs text-[#1E3F33] hover:underline flex items-center gap-1 flex-shrink-0">
                Ver acertos <ArrowRight size={12} />
              </span>
            </div>
          </Link>
        );
      })()}

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
                <Select value={form.group_id} onValueChange={applyGroup}>
                  <SelectTrigger data-testid="shared-group-select"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {form.group_id && (
                  <p className="text-xs text-[#6B7068] mt-1">Os membros do grupo foram adicionados automaticamente como participantes.</p>
                )}
              </div>
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
                {(() => {
                  const preview = previewSplit();
                  return participants.map(p => (
                    <div key={p.user.id} className="flex items-center gap-2 p-2 bg-[#F1EFE7] rounded-lg">
                      <Initials name={p.user.name} color={p.user.avatar_color} />
                      <div className="flex-1 text-sm min-w-0">
                        <div className="font-medium truncate">{p.user.name}</div>
                        <div className="text-xs text-[#6B7068] truncate">{p.user.email}</div>
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
                      <div className="text-sm font-semibold text-[#1E3F33] w-20 text-right" data-testid={`preview-share-${p.user.id}`}>
                        {fmtMoney(preview[p.user.id] || 0, curr)}
                      </div>
                      {p.user.id !== user.id && (
                        <button type="button" onClick={() => removeParticipant(p.user.id)} className="text-[#6B7068] hover:text-[#D9453B]">
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ));
                })()}
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
                  {/* Resumo em 1 linha: quanto cada um deve */}
                  <div className="mt-1.5 text-xs text-[#6B7068] flex flex-wrap gap-x-3 gap-y-0.5" data-testid={`shared-summary-${e.id}`}>
                    {e.participants.map(p => {
                      const isPayer = p.user_id === e.payer_id;
                      const name = (p.user?.name || "").split(" ")[0];
                      if (isPayer) {
                        return (
                          <span key={p.user_id} className="text-emerald-700">
                            <strong>{name}</strong> {fmtMoney(p.owed || 0, curr)} (pagou)
                          </span>
                        );
                      }
                      return (
                        <span key={p.user_id} className={p.paid_back ? "text-emerald-600" : ""}>
                          <strong>{name}</strong> {fmtMoney(p.owed || 0, curr)}{p.paid_back ? " ✓" : ""}
                        </span>
                      );
                    })}
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
                  const iAmPayer = e.payer_id === user.id;       // eu recebo
                  const iAmThisDebtor = p.user_id === user.id;   // eu devo
                  let actionLabel = "Marcar pago";
                  let actionTitle = "Confirmar pagamento";
                  if (iAmPayer && !isPayer) {
                    actionLabel = p.paid_back ? "Recebido" : "Confirmar recebimento";
                    actionTitle = "Confirmar que recebi este valor";
                  } else if (iAmThisDebtor) {
                    actionLabel = p.paid_back ? "Pago" : "Já paguei";
                    actionTitle = "Marcar que já paguei minha parte";
                  } else if (!isPayer) {
                    actionLabel = p.paid_back ? "Pago" : "Marcar pago";
                  }
                  return (
                    <div key={p.user_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#F1EFE7]" data-testid={`participant-row-${e.id}-${p.user_id}`}>
                      <Initials name={p.user?.name} color={p.user?.avatar_color} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {p.user?.name}
                          {isPayer && <span className="ml-2 text-xs text-emerald-600">(pagou tudo)</span>}
                        </div>
                        <div className="text-xs text-[#6B7068]">
                          {isPayer
                            ? `Adiantou ${fmtMoney(e.amount, curr)} pelo grupo`
                            : (p.paid_back ? "Acerto confirmado" : `Deve para ${e.payer?.name}`)}
                        </div>
                      </div>
                      {/* Valor da parte da pessoa em destaque */}
                      <div className={`text-base font-semibold whitespace-nowrap ${
                        isPayer ? "text-[#1E3F33]" : p.paid_back ? "text-emerald-600 line-through opacity-60" : "text-rose-600"
                      }`} style={{ fontFamily: "Outfit" }} data-testid={`participant-amount-${e.id}-${p.user_id}`}>
                        {fmtMoney(p.owed || 0, curr)}
                      </div>
                      {!isPayer && (
                        <button onClick={() => togglePaid(e.id, p.user_id)} data-testid={`settle-${e.id}-${p.user_id}`}
                          title={actionTitle}
                          className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${
                            p.paid_back
                              ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              : "bg-[#1E3F33] text-white hover:bg-[#2C5C4A]"
                          }`}>
                          {p.paid_back ? <><Check size={12} className="inline mr-1" />{actionLabel}</> : actionLabel}
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
