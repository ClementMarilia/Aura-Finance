import { useEffect, useState } from "react";
import api, { fmtMoney, fmtDate, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Check, Trash2, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export default function Installments() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [list, setList] = useState([]);
  const [cats, setCats] = useState([]);
  const [accs, setAccs] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [editForm, setEditForm] = useState({ description: "", category_id: "", payment_method: "", account_id: "" });
  const [form, setForm] = useState({
    description: "", total_amount: "", installments: 1,
    first_date: new Date().toISOString().slice(0, 10), category_id: "", payment_method: "", account_id: "",
  });

  const load = () => api.get("/installments/purchases").then(r => setList(r.data));
  useEffect(() => {
    load();
    api.get("/categories").then(r => setCats(r.data));
    api.get("/accounts").then(r => setAccs(r.data || []));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/installments/purchases", {
        ...form,
        total_amount: parseFloat(form.total_amount),
        installments: parseInt(form.installments, 10),
        category_id: form.category_id || null,
        account_id: form.account_id || null,
      });
      toast.success("Parcelamento criado");
      setOpen(false); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const openEdit = (p) => {
    setEditing(p);
    setEditForm({
      description: p.description,
      category_id: p.category_id || "",
      payment_method: p.payment_method || "",
      account_id: p.account_id || "",
    });
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/installments/purchases/${editing.id}`, {
        description: editForm.description,
        category_id: editForm.category_id || null,
        payment_method: editForm.payment_method,
        account_id: editForm.account_id || null,
      });
      toast.success("Atualizado");
      setEditing(null); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const togglePay = async (iid) => { await api.post(`/installments/${iid}/pay`); load(); };
  const removePurchase = async () => {
    if (!confirmDel) return;
    await api.delete(`/installments/purchases/${confirmDel.id}`);
    setConfirmDel(null);
    toast.success("Parcelamento excluído");
    load();
  };

  return (
    <div className="space-y-6" data-testid="installments-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Parcelamentos</h1>
          <p className="text-[#6B7068]">Compras parceladas com geração automática</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-installment-button" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">
              <Plus size={16} className="mr-1" /> Nova compra parcelada
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova compra parcelada</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>Descrição</Label>
                <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required data-testid="inst-description-input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Valor total</Label>
                  <Input type="number" step="0.01" value={form.total_amount} required data-testid="inst-total-input"
                    onChange={e => setForm({ ...form, total_amount: e.target.value })} /></div>
                <div><Label>Nº parcelas</Label>
                  <Input type="number" min="1" max="120" value={form.installments} required data-testid="inst-count-input"
                    onChange={e => setForm({ ...form, installments: e.target.value })} /></div>
                <div><Label>Primeira parcela</Label>
                  <Input type="date" value={form.first_date} required data-testid="inst-date-input"
                    onChange={e => setForm({ ...form, first_date: e.target.value })} /></div>
                <div><Label>Forma de pagamento</Label>
                  <Input value={form.payment_method} data-testid="inst-payment-input"
                    onChange={e => setForm({ ...form, payment_method: e.target.value })} /></div>
                <div className="col-span-2"><Label>Categoria</Label>
                  <Select value={form.category_id} onValueChange={v => setForm({ ...form, category_id: v })}>
                    <SelectTrigger data-testid="inst-category-select"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select></div>
                <div className="col-span-2"><Label>Carteira (pagamento sai daqui ao confirmar a parcela)</Label>
                  <Select value={form.account_id} onValueChange={v => setForm({ ...form, account_id: v })}>
                    <SelectTrigger data-testid="inst-account-select"><SelectValue placeholder="Selecione a carteira" /></SelectTrigger>
                    <SelectContent>
                      {accs.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select></div>
              </div>
              <Button type="submit" className="w-full bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl" data-testid="inst-submit-button">Criar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {list.length > 0 && (() => {
        const allParcels = list.flatMap(p => p.installments_list);
        const pendingTotal = allParcels.filter(i => i.status === "pending").reduce((s, i) => s + i.amount, 0);
        const paidTotal = allParcels.filter(i => i.status === "paid").reduce((s, i) => s + i.amount, 0);
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="inst-summary">
            <div className="card-soft">
              <div className="text-sm text-[#6B7068]">Total pendente (parcelas em aberto)</div>
              <div className="text-2xl font-semibold text-rose-600 mt-1" style={{ fontFamily: "Outfit" }} data-testid="inst-pending-total">
                {fmtMoney(pendingTotal, curr)}
              </div>
              <div className="text-xs text-[#6B7068] mt-1">Só sai da carteira quando você confirmar o pagamento</div>
            </div>
            <div className="card-soft">
              <div className="text-sm text-[#6B7068]">Total já pago</div>
              <div className="text-2xl font-semibold text-emerald-600 mt-1" style={{ fontFamily: "Outfit" }} data-testid="inst-paid-total">
                {fmtMoney(paidTotal, curr)}
              </div>
            </div>
          </div>
        );
      })()}

      <div className="space-y-4">
        {list.length === 0 && <div className="card-soft text-center text-[#6B7068]">Nenhum parcelamento ainda</div>}
        {list.map(p => {
          const paid = p.installments_list.filter(i => i.status === "paid").length;
          const remaining = p.installments - paid;
          const next = p.installments_list.find(i => i.status === "pending");
          const isOpen = !!expanded[p.id];
          const toggle = () => setExpanded(prev => ({ ...prev, [p.id]: !prev[p.id] }));
          return (
            <div key={p.id} className="card-soft" data-testid={`purchase-${p.id}`}>
              <div className="flex items-start justify-between flex-wrap gap-3">
                <button onClick={toggle} data-testid={`purchase-toggle-${p.id}`} className="flex items-start gap-2 text-left flex-1">
                  <span className="mt-1 text-[#6B7068]">{isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                  <div>
                    <div className="text-lg font-semibold" style={{ fontFamily: "Outfit" }}>{p.description}</div>
                    <div className="text-sm text-[#6B7068]">
                      {p.installments}x · {fmtMoney(p.total_amount, p.currency || curr)} · Pagas: {paid}/{p.installments}
                      {p.account_id && accs.find(a => a.id === p.account_id) && (
                        <> · {accs.find(a => a.id === p.account_id).name}</>
                      )}
                    </div>
                    {!isOpen && (
                      <div className="text-xs text-[#1E3F33] mt-1" data-testid={`purchase-summary-${p.id}`}>
                        {next
                          ? <>Próxima: <b>Parcela {next.number}/{next.total}</b> · {fmtMoney(next.amount, p.currency || curr)} · vence {fmtDate(next.due_date)} · faltam {remaining}</>
                          : <>Tudo pago! 🎉</>}
                      </div>
                    )}
                  </div>
                </button>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(p)} className="text-[#6B7068] hover:text-[#1E3F33] p-2 rounded-lg border border-[#E5E4E0]" data-testid={`purchase-edit-${p.id}`} title="Editar">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setConfirmDel(p)} className="text-[#6B7068] hover:text-[#D9453B] p-2 rounded-lg border border-[#E5E4E0]" data-testid={`purchase-delete-${p.id}`} title="Excluir">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {isOpen && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {p.installments_list.map(i => (
                  <button key={i.id} onClick={() => togglePay(i.id)} data-testid={`installment-${i.id}`}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      i.status === "paid"
                        ? "bg-[#1E3F33] text-white border-transparent"
                        : "bg-white border-[#E5E4E0] hover:bg-[#F1EFE7]"
                    }`}>
                    <div className="text-xs opacity-80">Parcela {i.number}/{i.total}</div>
                    <div className="font-semibold text-sm mt-1">{fmtMoney(i.amount, p.currency || curr)}</div>
                    <div className="text-xs opacity-80 mt-1">{fmtDate(i.due_date)}</div>
                    <div className="text-xs mt-2 flex items-center gap-1">
                      {i.status === "paid" ? <><Check size={12} /> Pago</> : "Pendente"}
                    </div>
                  </button>
                ))}
              </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar parcelamento</DialogTitle></DialogHeader>
          <form onSubmit={submitEdit} className="space-y-3">
            <div><Label>Descrição</Label>
              <Input value={editForm.description} required data-testid="purchase-edit-description"
                onChange={e => setEditForm({ ...editForm, description: e.target.value })} /></div>
            <div><Label>Forma de pagamento</Label>
              <Input value={editForm.payment_method} data-testid="purchase-edit-payment"
                onChange={e => setEditForm({ ...editForm, payment_method: e.target.value })} /></div>
            <div><Label>Categoria</Label>
              <Select value={editForm.category_id} onValueChange={v => setEditForm({ ...editForm, category_id: v })}>
                <SelectTrigger data-testid="purchase-edit-category"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label>Carteira</Label>
              <Select value={editForm.account_id} onValueChange={v => setEditForm({ ...editForm, account_id: v })}>
                <SelectTrigger data-testid="purchase-edit-account"><SelectValue placeholder="Selecione a carteira" /></SelectTrigger>
                <SelectContent>
                  {accs.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <p className="text-xs text-[#6B7068]">Para alterar valor total ou número de parcelas, exclua e crie um novo parcelamento.</p>
            <Button type="submit" className="w-full bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl" data-testid="purchase-edit-submit">Salvar alterações</Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title="Excluir parcelamento?"
        description={confirmDel ? `"${confirmDel.description}" e todas as ${confirmDel.installments} parcelas serão removidas. Esta ação não pode ser desfeita.` : ""}
        onConfirm={removePurchase}
        testId="purchase-confirm-delete"
      />
    </div>
  );
}
