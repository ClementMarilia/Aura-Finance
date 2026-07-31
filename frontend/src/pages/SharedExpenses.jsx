import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { CURRENCIES, fmtMoney, fmtDate, formatApiError, postCreate } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Trash2, UserPlus, X, Check, Pencil, ArrowRight, Scale, Wallet } from "lucide-react";
import { toast } from "sonner";

import { translate as tr } from "@/i18n";
function Initials({ name, color, size = 28 }) {
  const initials = (name || "?").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="rounded-full flex items-center justify-center text-white text-xs font-medium"
      style={{ width: size, height: size, backgroundColor: color || "#061B4A" }}>
      {initials}
    </div>
  );
}

const emptyForm = (user) => ({
  title: "", amount: "", date: new Date().toISOString().slice(0, 10),
  category: tr("Mercado"), category_id: "", payer_id: user?.id || "",
  split_type: "equal", group_id: "", account_id: "", notes: "",
  currency: user?.currency || "EUR",
});

export default function SharedExpenses() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [list, setList] = useState([]);
  const [groups, setGroups] = useState([]);
  const [people, setPeople] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState([]); // {user, net}
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // expense being edited or null
  const [participants, setParticipants] = useState([]);
  const [searchEmail, setSearchEmail] = useState("");
  const [externalName, setExternalName] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm(user));
  const [confirmDelete, setConfirmDelete] = useState(null); // expense id
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [linkingExpense, setLinkingExpense] = useState(null);
  const [linkingAccountId, setLinkingAccountId] = useState("");

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      api.get("/shared-expenses", {
        params: currencyFilter ? { currency: currencyFilter } : {},
      }),
      api.get("/settlements"),
      api.get("/people"),
    ]);
    setList(a.data);
    setSummary(b.data.summary || []);
    setPeople(c.data);
  }, [currencyFilter]);
  useEffect(() => {
    Promise.all([
      api.get("/groups"),
      api.get("/accounts"),
      api.get("/categories"),
    ]).then(([groupResponse, accountResponse, categoryResponse]) => {
      setGroups(groupResponse.data);
      setAccounts(accountResponse.data);
      setCategories(categoryResponse.data.filter(item => item.kind !== "income"));
    });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    const defaultCategory = categories.find(item => item.name === "Mercado");
    setEditing(null);
    setForm({
      ...emptyForm(user),
      category: defaultCategory?.name || tr("Mercado"),
      category_id: defaultCategory?.id || "",
    });
    setParticipants([{ user, user_id: user.id, amount: "", percent: "" }]);
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
        if (!existing.has(m.id)) existing.set(m.id, { user: m, user_id: m.id, amount: "", percent: "" });
      });
      // garante o próprio usuário sempre
      if (!existing.has(user.id)) existing.set(user.id, { user, user_id: user.id, amount: "", percent: "" });
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
      category_id: e.category_id || "", group_id: e.group_id || "",
      account_id: e.account_id || "", notes: e.notes || "",
      currency: e.currency || curr,
    });
    setParticipants(e.participants.map(p => ({
      user: p.user,
      user_id: p.user_id || null,
      person_id: p.person_id || null,
      amount: p.owed ? String(p.owed) : "",
      percent: "",
    })));
    setOpen(true);
  };

  const addParticipantByEmail = async () => {
    if (!searchEmail) return;
    try {
      const r = await api.get("/users/search", { params: { email: searchEmail } });
      if (!r.data) { toast.error(tr("Usuário não encontrado")); return; }
      if (participants.some(p => p.user.id === r.data.id)) { toast.warning(tr("Já adicionado")); return; }
      setParticipants([...participants, { user: r.data, user_id: r.data.id, amount: "", percent: "" }]);
      setSearchEmail("");
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const addExternalPerson = (person) => {
    if (!person) return;
    if (participants.some(item => item.user.id === person.id)) {
      toast.warning(tr("Já adicionado"));
      return;
    }
    setParticipants([
      ...participants,
      { user: person, person_id: person.id, user_id: null, amount: "", percent: "" },
    ]);
  };

  const createAndAddExternalPerson = async () => {
    const name = externalName.trim();
    if (!name) return;
    try {
      const response = await postCreate("/people", {
        name, nickname: "", relationship: "", notes: "",
      });
      const person = response.data;
      setPeople(current => [...current, person].sort((a, b) => a.name.localeCompare(b.name)));
      addExternalPerson(person);
      setExternalName("");
      toast.success(tr("Pessoa adicionada"));
    } catch (error) {
      toast.error(formatApiError(error));
    }
  };

  const removeParticipant = (id) => setParticipants(participants.filter(p => p.user.id !== id));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const body = {
        title: form.title, amount: parseFloat(form.amount), date: form.date,
        category: form.category, category_id: form.category_id || null,
        payer_id: form.payer_id, split_type: form.split_type,
        group_id: form.group_id || null,
        account_id: form.payer_id === user.id ? (form.account_id || null) : null,
        notes: form.notes,
        currency: form.currency,
        participants: participants.map(p => ({
          user_id: p.user_id || null,
          person_id: p.person_id || null,
          amount: p.amount ? parseFloat(p.amount) : null,
          percent: p.percent ? parseFloat(p.percent) : null,
        })),
      };
      if (editing) {
        await api.put(`/shared-expenses/${editing.id}`, body);
        toast.success(tr("Despesa atualizada"));
      } else {
        await postCreate("/shared-expenses", body);
        toast.success(tr("Despesa compartilhada criada"));
      }
      setOpen(false); setEditing(null); setParticipants([]);
      setForm(emptyForm(user));
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const togglePaid = async (sid, uid) => {
    try {
      await api.post(`/shared-expenses/${sid}/settle/${uid}`);
      toast.success(tr("Acerto confirmado"));
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/shared-expenses/${confirmDelete.id}`);
      toast.success(tr("Despesa excluída"));
      setConfirmDelete(null);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
      setConfirmDelete(null);
    }
  };

  const linkAccount = async () => {
    if (!linkingExpense || !linkingAccountId) return;
    try {
      await api.put(`/shared-expenses/${linkingExpense.id}/account`, {
        account_id: linkingAccountId,
      });
      toast.success(tr("Carteira vinculada"));
      setLinkingExpense(null);
      setLinkingAccountId("");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="space-y-6" data-testid="shared-expenses-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>{tr("Despesas Compartilhadas")}</h1>
          <p className="text-[#6B7068]">{tr("Apenas você e os participantes podem ver cada despesa")}</p>
        </div>
        <Button onClick={openNew} data-testid="new-shared-button"
          className="bg-[#D96C5B] hover:bg-[#C25848] text-white rounded-xl">
          <Plus size={16} className="mr-1" /> {tr("Nova despesa")}
        </Button>
      </div>

      <div className="flex justify-end">
        <select value={currencyFilter} onChange={event => setCurrencyFilter(event.target.value)}
          data-testid="shared-currency-filter" className="bg-white border border-[#E5E4E0] rounded-xl px-3 py-2 text-sm">
          <option value="">{tr("Todas as moedas")}</option>
          {CURRENCIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
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
              <Scale size={16} className="text-[#061B4A] flex-shrink-0" />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm flex-1 min-w-0">
                {credits.map(s => (
                  <span key={s.user?.id} className="text-emerald-700" data-testid={`banner-credit-${s.user?.id}`}>
                    <strong>{(s.user?.name || "").split(" ")[0]}</strong> te deve{" "}
                    <strong>{fmtMoney(s.net, curr)}</strong>
                  </span>
                ))}
                {debts.map(s => (
                  <span key={s.user?.id} className="text-rose-700" data-testid={`banner-debt-${s.user?.id}`}>
                    {tr("Você deve")} <strong>{fmtMoney(Math.abs(s.net), curr)}</strong>{" "}
                    para <strong>{(s.user?.name || "").split(" ")[0]}</strong>
                  </span>
                ))}
              </div>
              <span className="text-xs text-[#061B4A] hover:underline flex items-center gap-1 flex-shrink-0">
                {tr("Ver acertos")} <ArrowRight size={12} />
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
              <div className="col-span-2"><Label>{tr("Título")}</Label>
                <Input value={form.title} required data-testid="shared-title-input"
                  onChange={e => setForm({ ...form, title: e.target.value })} /></div>
              <div><Label>{tr("Valor total")}</Label>
                <Input type="number" step="0.01" value={form.amount} required data-testid="shared-amount-input"
                  onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div><Label>{tr("Data")}</Label>
                <Input type="date" value={form.date} required data-testid="shared-date-input"
                  onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div><Label>{tr("Moeda")}</Label>
                <Select value={form.currency} onValueChange={value => setForm({ ...form, currency: value })}>
                  <SelectTrigger data-testid="shared-currency-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select></div>
              <div><Label>{tr("Categoria")}</Label>
                <Select value={form.category_id} onValueChange={value => {
                  const category = categories.find(item => item.id === value);
                  setForm({ ...form, category_id: value, category: category?.name || form.category });
                }}>
                  <SelectTrigger data-testid="shared-category-select"><SelectValue placeholder={tr("Selecione a categoria")} /></SelectTrigger>
                  <SelectContent>
                    {categories.map(category => (
                      <SelectItem key={category.id} value={category.id}>{tr(category.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select></div>
              <div><Label>{tr("Grupo (opcional)")}</Label>
                <Select value={form.group_id} onValueChange={applyGroup}>
                  <SelectTrigger data-testid="shared-group-select"><SelectValue placeholder={tr("Nenhum")} /></SelectTrigger>
                  <SelectContent>
                    {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {form.group_id && (
                  <p className="text-xs text-[#6B7068] mt-1">{tr("Os membros do grupo foram adicionados automaticamente como participantes.")}</p>
                )}
              </div>
            </div>

            <div>
              <Label>{tr("Participantes")}</Label>
              <div className="flex gap-2 mt-1.5">
                <Input type="email" placeholder="email@exemplo.com" value={searchEmail}
                  onChange={e => setSearchEmail(e.target.value)} data-testid="shared-add-email-input" />
                <Button type="button" onClick={addParticipantByEmail} data-testid="shared-add-participant-button"
                  className="bg-[#061B4A] hover:bg-[#1268F4] rounded-xl"><UserPlus size={16} /></Button>
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Select onValueChange={value => addExternalPerson(people.find(person => person.id === value))}>
                  <SelectTrigger data-testid="shared-person-select">
                    <SelectValue placeholder={tr("Selecionar pessoa cadastrada")} />
                  </SelectTrigger>
                  <SelectContent>
                    {people.map(person => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name}{person.nickname ? ` (${person.nickname})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Input
                    value={externalName}
                    onChange={event => setExternalName(event.target.value)}
                    placeholder={tr("Nova pessoa externa")}
                    data-testid="shared-external-name"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={createAndAddExternalPerson}
                    data-testid="shared-add-external"
                  >
                    <Plus size={16} />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-[#6B7068] mt-2">
                {tr("Pessoas externas são privadas: não recebem convite, acesso ou notificação.")}
              </p>
              <div className="mt-3 space-y-2">
                {(() => {
                  const preview = previewSplit();
                  return participants.map(p => (
                    <div key={p.user.id} className="flex items-center gap-2 p-2 bg-[#F1EFE7] rounded-lg">
                      <Initials name={p.user.name} color={p.user.avatar_color} />
                      <div className="flex-1 text-sm min-w-0">
                        <div className="font-medium truncate">{p.user.name}</div>
                        <div className="text-xs text-[#6B7068] truncate">
                          {p.user.external ? tr("Pessoa externa") : p.user.email}
                        </div>
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
                      <div className="text-sm font-semibold text-[#061B4A] w-20 text-right" data-testid={`preview-share-${p.user.id}`}>
                        {fmtMoney(preview[p.user.id] || 0, form.currency || curr)}
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
              <div><Label>{tr("Tipo de divisão")}</Label>
                <Select value={form.split_type} onValueChange={v => setForm({ ...form, split_type: v })}>
                  <SelectTrigger data-testid="shared-split-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equal">{tr("Igual entre todos")}</SelectItem>
                    <SelectItem value="manual">{tr("Valor manual")}</SelectItem>
                    <SelectItem value="percent">{tr("Percentual")}</SelectItem>
                  </SelectContent>
                </Select></div>
              <div><Label>{tr("Quem pagou")}</Label>
                <Select value={form.payer_id} onValueChange={v => setForm({
                  ...form,
                  payer_id: v,
                  account_id: v === user.id ? form.account_id : "",
                })}>
                  <SelectTrigger data-testid="shared-payer-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {participants.map(p => <SelectItem key={p.user.id} value={p.user.id}>{p.user.name}</SelectItem>)}
                  </SelectContent>
                </Select></div>
            </div>

            {form.payer_id === user.id && (
              <div>
                <Label>{tr("Carteira usada no pagamento")}</Label>
                <Select value={form.account_id} onValueChange={value => {
                  const account = accounts.find(item => item.id === value);
                  setForm({
                    ...form,
                    account_id: value,
                    currency: account?.currency || form.currency,
                  });
                }}>
                  <SelectTrigger data-testid="shared-account-select">
                    <SelectValue placeholder={tr("Selecione a carteira")} />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map(account => (
                      <SelectItem key={account.id} value={account.id}>
                        {tr(account.name)} ({account.currency || curr})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-[#6B7068]">
                  {tr("O valor total aparecerá em Lançamentos e será descontado desta carteira.")}
                </p>
              </div>
            )}

            <Button type="submit" disabled={saving} className="w-full bg-[#061B4A] hover:bg-[#1268F4] rounded-xl" data-testid="shared-submit-button">
              {saving ? tr("Salvando...") : editing ? tr("Salvar alterações") : tr("Criar despesa")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
        title={tr("Excluir despesa?")}
        description={confirmDelete ? tr("{item}. Esta ação não pode ser desfeita.", { item: `"${confirmDelete.title}" - ${fmtMoney(confirmDelete.amount, confirmDelete.currency || curr)}` }) : ""}
        onConfirm={doDelete}
        testId="shared-confirm-delete"
      />

      <Dialog open={!!linkingExpense} onOpenChange={value => {
        if (!value) {
          setLinkingExpense(null);
          setLinkingAccountId("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("Vincular carteira")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[#6B7068]">
              {tr("Escolha a carteira usada para pagar esta despesa. O valor total passará a aparecer em Lançamentos.")}
            </p>
            <Select value={linkingAccountId} onValueChange={setLinkingAccountId}>
              <SelectTrigger data-testid="link-shared-account-select">
                <SelectValue placeholder={tr("Selecione a carteira")} />
              </SelectTrigger>
              <SelectContent>
                {accounts
                  .filter(account => (account.currency || curr) === (linkingExpense?.currency || curr))
                  .map(account => (
                    <SelectItem key={account.id} value={account.id}>
                      {tr(account.name)} ({account.currency || curr})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={!linkingAccountId}
              onClick={linkAccount}
              className="bg-[#061B4A] hover:bg-[#1268F4]"
            >
              {tr("Vincular carteira")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-4">
        {list.length === 0 && <div className="card-soft text-center text-[#6B7068]">{tr("Nenhuma despesa compartilhada")}</div>}
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
                      const participantId = p.participant_id || p.user_id || p.person_id;
                      const isPayer = participantId === e.payer_id;
                      const name = (p.user?.name || "").split(" ")[0];
                      if (isPayer) {
                        return (
                          <span key={participantId} className="text-emerald-700">
                            <strong>{name}</strong> {fmtMoney(p.owed || 0, e.currency || curr)} (pagou)
                          </span>
                        );
                      }
                      return (
                        <span key={participantId} className={p.paid_back ? "text-emerald-600" : ""}>
                          <strong>{name}</strong> {fmtMoney(p.owed || 0, e.currency || curr)}{p.paid_back ? " ✓" : ""}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="text-right">
                    <div className="text-2xl font-semibold" style={{ fontFamily: "Outfit" }}>{fmtMoney(e.amount, e.currency || curr)}</div>
                  </div>
                  <div className="flex gap-1">
                    {e.payer_id === user.id && !e.account_id && (
                      <button
                        onClick={() => {
                          setLinkingExpense(e);
                          setLinkingAccountId("");
                        }}
                        data-testid={`shared-link-account-${e.id}`}
                        className="p-2 rounded-lg text-amber-700 hover:bg-amber-50 border border-amber-200"
                        title={tr("Vincular carteira")}
                      >
                        <Wallet size={16} />
                      </button>
                    )}
                    {canEdit && (
                      <button onClick={() => openEdit(e)} data-testid={`shared-edit-${e.id}`}
                        className="p-2 rounded-lg text-[#6B7068] hover:bg-[#F1EFE7] hover:text-[#061B4A] border border-[#E5E4E0]"
                        title={tr("Editar")}>
                        <Pencil size={16} />
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => setConfirmDelete(e)} data-testid={`shared-delete-${e.id}`}
                        className="p-2 rounded-lg text-[#6B7068] hover:bg-rose-50 hover:text-[#D9453B] border border-[#E5E4E0]"
                        title={tr("Excluir")}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {e.payer_id === user.id && (
                <div className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                  e.account_id
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}>
                  <Wallet size={12} />
                  {e.account_id
                    ? tr("Registrada em Lançamentos")
                    : tr("Vincule uma carteira para registrar a saída")}
                </div>
              )}

              <div className="mt-4 space-y-2">
                {e.participants.map(p => {
                  const participantId = p.participant_id || p.user_id || p.person_id;
                  const isPayer = participantId === e.payer_id;
                  const iAmPayer = e.payer_id === user.id;       // eu recebo
                  const iAmThisDebtor = participantId === user.id;   // eu devo
                  let actionLabel = tr("Marcar pago");
                  let actionTitle = "Confirmar pagamento";
                  if (iAmPayer && !isPayer) {
                    actionLabel = p.paid_back ? tr("Recebido") : "Confirmar recebimento";
                    actionTitle = "Confirmar que recebi este valor";
                  } else if (iAmThisDebtor) {
                    actionLabel = p.paid_back ? tr("Pago") : tr("Já paguei");
                    actionTitle = tr("Marcar que já paguei minha parte");
                  } else if (!isPayer) {
                    actionLabel = p.paid_back ? tr("Pago") : tr("Marcar pago");
                  }
                  return (
                    <div key={participantId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#F1EFE7]" data-testid={`participant-row-${e.id}-${participantId}`}>
                      <Initials name={p.user?.name} color={p.user?.avatar_color} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {p.user?.name}
                          {isPayer && <span className="ml-2 text-xs text-emerald-600">(pagou tudo)</span>}
                        </div>
                        <div className="text-xs text-[#6B7068]">
                          {isPayer
                            ? `Adiantou ${fmtMoney(e.amount, e.currency || curr)} pelo grupo`
                            : (p.paid_back ? "Acerto confirmado" : `Deve para ${e.payer?.name}`)}
                        </div>
                      </div>
                      {/* Valor da parte da pessoa em destaque */}
                      <div className={`text-base font-semibold whitespace-nowrap ${
                        isPayer ? "text-[#061B4A]" : p.paid_back ? "text-emerald-600 line-through opacity-60" : "text-rose-600"
                      }`} style={{ fontFamily: "Outfit" }} data-testid={`participant-amount-${e.id}-${participantId}`}>
                        {fmtMoney(p.owed || 0, e.currency || curr)}
                      </div>
                      {!isPayer && (
                        <button onClick={() => togglePaid(e.id, participantId)} data-testid={`settle-${e.id}-${participantId}`}
                          disabled={p.paid_back}
                          title={actionTitle}
                          className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${
                            p.paid_back
                              ? "bg-emerald-50 text-emerald-700 cursor-default"
                              : "bg-[#061B4A] text-white hover:bg-[#1268F4]"
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
