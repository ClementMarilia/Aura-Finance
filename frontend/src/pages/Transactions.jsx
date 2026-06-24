import { useEffect, useState } from "react";
import api, { fmtMoney, fmtDate, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_LABEL = { paid: "Pago", pending: "Pendente", cancelled: "Cancelado" };
const TYPE_LABEL = { income: "Receita", expense: "Despesa", transfer: "Transferência" };

export default function Transactions() {
  const { user } = useAuth();
  const curr = user?.currency || "EUR";
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [accs, setAccs] = useState([]);
  const [filter, setFilter] = useState({ status: "", type: "", category_id: "" });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(defaultForm());

  function defaultForm() {
    return {
      type: "expense",
      date: new Date().toISOString().slice(0, 10),
      amount: "",
      category_id: "",
      account_id: "",
      payment_method: "",
      description: "",
      notes: "",
      status: "paid",
    };
  }

  const load = () => {
    const params = {};
    Object.entries(filter).forEach(([k, v]) => { if (v) params[k] = v; });
    api.get("/transactions", { params }).then(r => setItems(r.data));
  };

  useEffect(() => {
    api.get("/categories").then(r => setCats(r.data));
    api.get("/accounts").then(r => setAccs(r.data));
  }, []);
  useEffect(() => { load(); }, [filter.status, filter.type, filter.category_id]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/transactions", {
        ...form,
        amount: parseFloat(form.amount),
        category_id: form.category_id || null,
        account_id: form.account_id || null,
      });
      toast.success("Lançamento criado");
      setOpen(false); setForm(defaultForm()); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Excluir lançamento?")) return;
    await api.delete(`/transactions/${id}`);
    load();
  };

  return (
    <div className="space-y-6" data-testid="transactions-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "Outfit" }}>Lançamentos</h1>
          <p className="text-[#6B7068]">Receitas, despesas e transferências</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-transaction-button" className="bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">
              <Plus size={16} className="mr-1" /> Novo lançamento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg" data-testid="new-transaction-dialog">
            <DialogHeader><DialogTitle>Novo lançamento</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="tx-type-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="income">Receita</SelectItem>
                      <SelectItem value="expense">Despesa</SelectItem>
                      <SelectItem value="transfer">Transferência</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger data-testid="tx-status-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">Pago</SelectItem>
                      <SelectItem value="pending">Pendente</SelectItem>
                      <SelectItem value="cancelled">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Data</Label>
                  <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required data-testid="tx-date-input" />
                </div>
                <div>
                  <Label>Valor</Label>
                  <Input type="number" step="0.01" value={form.amount}
                    onChange={e => setForm({ ...form, amount: e.target.value })} required data-testid="tx-amount-input" />
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                    <SelectTrigger data-testid="tx-category-select"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Conta</Label>
                  <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                    <SelectTrigger data-testid="tx-account-select"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {accs.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Forma de pagamento</Label>
                  <Input value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })}
                    placeholder="Ex: Cartão de crédito" data-testid="tx-payment-input" />
                </div>
                <div className="col-span-2">
                  <Label>Descrição</Label>
                  <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} data-testid="tx-description-input" />
                </div>
                <div className="col-span-2">
                  <Label>Observações</Label>
                  <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} data-testid="tx-notes-input" />
                </div>
              </div>
              <Button type="submit" data-testid="tx-submit-button" className="w-full bg-[#1E3F33] hover:bg-[#2C5C4A] rounded-xl">Salvar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="card-soft p-4">
        <div className="flex flex-wrap gap-3">
          <select value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}
            data-testid="filter-type" className="bg-white border border-[#E5E4E0] rounded-lg px-3 py-2 text-sm">
            <option value="">Todos os tipos</option>
            <option value="income">Receita</option>
            <option value="expense">Despesa</option>
            <option value="transfer">Transferência</option>
          </select>
          <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}
            data-testid="filter-status" className="bg-white border border-[#E5E4E0] rounded-lg px-3 py-2 text-sm">
            <option value="">Todos status</option>
            <option value="paid">Pago</option>
            <option value="pending">Pendente</option>
            <option value="cancelled">Cancelado</option>
          </select>
          <select value={filter.category_id} onChange={e => setFilter({ ...filter, category_id: e.target.value })}
            data-testid="filter-category" className="bg-white border border-[#E5E4E0] rounded-lg px-3 py-2 text-sm">
            <option value="">Todas categorias</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="card-soft overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-[#F1EFE7] text-[#6B7068]">
            <tr>
              <th className="text-left py-3 px-4">Data</th>
              <th className="text-left py-3 px-4">Descrição</th>
              <th className="text-left py-3 px-4">Categoria</th>
              <th className="text-left py-3 px-4">Tipo</th>
              <th className="text-left py-3 px-4">Status</th>
              <th className="text-right py-3 px-4">Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-[#6B7068]">Nenhum lançamento</td></tr>
            )}
            {items.map(t => {
              const cat = cats.find(c => c.id === t.category_id);
              return (
                <tr key={t.id} className="border-b border-[#E5E4E0]" data-testid={`tx-row-${t.id}`}>
                  <td className="py-3 px-4">{fmtDate(t.date)}</td>
                  <td className="py-3 px-4 font-medium">{t.description || "—"}</td>
                  <td className="py-3 px-4">
                    {cat ? <span className="inline-flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />{cat.name}
                    </span> : "—"}
                  </td>
                  <td className="py-3 px-4">{TYPE_LABEL[t.type]}</td>
                  <td className="py-3 px-4">
                    <span className={`pill pill-${t.status}`}>{STATUS_LABEL[t.status]}</span>
                  </td>
                  <td className={`py-3 px-4 text-right font-medium ${
                    t.type === "income" ? "text-emerald-600" : t.type === "expense" ? "text-rose-600" : "text-[#1A1C1A]"
                  }`}>
                    {t.type === "expense" ? "-" : t.type === "income" ? "+" : ""}{fmtMoney(t.amount, curr)}
                  </td>
                  <td className="py-3 px-4">
                    <button onClick={() => remove(t.id)} className="text-[#6B7068] hover:text-[#D9453B]" data-testid={`tx-delete-${t.id}`}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
