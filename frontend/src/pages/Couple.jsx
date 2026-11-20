import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { translate as tr } from "@/i18n";
import "@/i18n/couple";

const emptyState = { link: null, direction: null, partner: null };

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatAmount(value, currency = "EUR") {
  return Number(value || 0).toLocaleString(undefined, { style: "currency", currency });
}

const emptyExpense = { description: "", amount: "", date: "", due_date: "", account_id: "" };

function SharedBills({ partnerName, onChanged }) {
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({ ...emptyExpense, date: todayIso() });
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/couple/shared-items").then(response => setItems(response.data.items || []));

  useEffect(() => {
    load().catch(error => toast.error(formatApiError(error)));
    api.get("/accounts")
      .then(response => setAccounts(Array.isArray(response.data) ? response.data : []))
      .catch(() => {});
  }, []);

  const update = (field, value) => setForm(current => ({ ...current, [field]: value }));

  const run = async (request, successMessage) => {
    if (busy) return;
    setBusy(true);
    try {
      await request();
      if (successMessage) toast.success(successMessage);
      await Promise.all([load(), onChanged?.()]);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!form.description.trim() || !(amount > 0) || !form.date || !form.due_date || !form.account_id) {
      toast.error(tr("Preencha descrição, valor, datas e carteira."));
      return;
    }
    run(
      async () => {
        await api.post("/couple/shared-expenses", {
          description: form.description.trim(),
          amount,
          date: form.date,
          due_date: form.due_date,
          account_id: form.account_id,
        });
        setForm({ ...emptyExpense, date: todayIso() });
      },
      tr("Conta dividida registrada"),
    );
  };

  return (
    <section className="space-y-4" data-testid="couple-shared">
      <h2 className="text-lg font-semibold">{tr("Nós dois")}</h2>

      <form onSubmit={submit} className="max-w-xl space-y-3 rounded-2xl border border-[#E5E4E0] p-5" data-testid="couple-shared-form">
        <h3 className="font-medium">{tr("Nova conta dividida")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="shared-description">{tr("Descrição")}</Label>
            <Input id="shared-description" value={form.description}
              onChange={event => update("description", event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shared-amount">{tr("Valor total")}</Label>
            <Input id="shared-amount" type="number" min="0" step="0.01" inputMode="decimal"
              value={form.amount} onChange={event => update("amount", event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shared-account">{tr("Carteira usada")}</Label>
            <select id="shared-account"
              className="h-10 w-full rounded-md border border-[#E5E4E0] bg-transparent px-3 text-sm"
              value={form.account_id} onChange={event => update("account_id", event.target.value)}>
              <option value="">—</option>
              {accounts.map(account => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="shared-date">{tr("Data do pagamento")}</Label>
            <Input id="shared-date" type="date" value={form.date}
              onChange={event => update("date", event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shared-due">{tr("Data combinada para a outra pessoa pagar")}</Label>
            <Input id="shared-due" type="date" value={form.due_date}
              onChange={event => update("due_date", event.target.value)} />
          </div>
        </div>
        <Button type="submit" disabled={busy} data-testid="couple-shared-submit">
          {tr("Registrar: eu paguei")}
        </Button>
      </form>

      {items.length === 0 && (
        <p className="text-sm text-[#6B7068]">{tr("Nenhuma conta dividida ainda.")}</p>
      )}

      <ul className="space-y-2" data-testid="couple-shared-items">
        {items.map(item => {
          const settled = item.status === "paid" || item.payment_state === "confirmed";
          const overdue = !settled && item.date && item.date < todayIso();
          return (
            <li key={item.id} className="max-w-xl rounded-2xl border border-[#E5E4E0] p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{item.description}</span>
                {overdue && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">{tr("Atrasado")}</span>
                )}
              </div>
              <p className="text-sm">
                {item.role === "debtor"
                  ? tr("Você deve {amount}", { amount: formatAmount(item.amount, item.currency) })
                  : tr("{name} deve {amount} a você", { name: partnerName, amount: formatAmount(item.amount, item.currency) })}
              </p>
              <p className="text-xs text-[#6B7068]">{tr("Vence em {date}", { date: item.date })}</p>
              <div className="flex flex-wrap gap-2">
                {settled && <span className="text-sm text-emerald-700">{tr("Pago")}</span>}
                {!settled && item.role === "debtor" && item.payment_state === "pending" && (
                  <Button size="sm" disabled={busy}
                    onClick={() => run(() => api.post(`/transactions/${item.id}/pay`), tr("Pagamento informado. Aguardando confirmação."))}>
                    {tr("Já paguei")}
                  </Button>
                )}
                {!settled && item.role === "debtor" && item.payment_state === "awaiting_confirmation" && (
                  <span className="text-sm text-[#6B7068]">{tr("Aguardando confirmação")}</span>
                )}
                {!settled && item.role === "creditor" && (
                  <Button size="sm" disabled={busy}
                    onClick={() => run(() => api.post(`/couple/shared-items/${item.id}/received`), tr("Recebimento confirmado"))}>
                    {tr("Recebi")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Couple() {
  const [state, setState] = useState(emptyState);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const load = () => api.get("/couple").then(response => setState(response.data));

  useEffect(() => {
    load().catch(error => toast.error(formatApiError(error))).finally(() => setLoading(false));
  }, []);

  const run = async (request, successMessage) => {
    if (busy) return;
    setBusy(true);
    try {
      await request();
      if (successMessage) toast.success(successMessage);
      await load();
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setBusy(false);
    }
  };

  const sendInvite = (event) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    run(
      async () => {
        await api.post("/couple/invitations", { email: trimmed });
        setEmail("");
      },
      tr("Se este e-mail tiver uma conta ativa, o convite foi enviado."),
    );
  };

  const { link, direction, partner } = state;
  const partnerName = partner?.name || tr("sua pessoa");

  return (
    <div className="space-y-6" data-testid="couple-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Heart className="h-6 w-6 text-[#1268F4]" aria-hidden="true" /> {tr("Casal")}
        </h1>
        <p className="text-sm text-[#6B7068] mt-1">
          {tr("Conecte as contas de vocês para dividir gastos como casal. Suas carteiras e lançamentos continuam privados.")}
        </p>
      </div>

      {loading && <p className="text-sm text-[#6B7068]">{tr("Carregando...")}</p>}

      {!loading && !link && (
        <form onSubmit={sendInvite} className="max-w-md space-y-3 rounded-2xl border border-[#E5E4E0] p-5">
          <div className="space-y-1">
            <Label htmlFor="couple-email">{tr("E-mail da pessoa")}</Label>
            <Input
              id="couple-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              data-testid="couple-email"
            />
          </div>
          <p className="text-xs text-[#6B7068]">
            {tr("Só é possível convidar contas já cadastradas. Por privacidade, não informamos se um e-mail existe.")}
          </p>
          <Button type="submit" disabled={busy || !email.trim()} data-testid="couple-invite-submit">
            {tr("Enviar convite")}
          </Button>
        </form>
      )}

      {!loading && link?.status === "pending" && direction === "incoming" && (
        <div className="max-w-md space-y-3 rounded-2xl border border-[#E5E4E0] p-5" data-testid="couple-incoming">
          <p>{tr("{name} convidou você para conectar as contas como casal.", { name: partnerName })}</p>
          <div className="flex gap-2">
            <Button
              onClick={() => run(() => api.post(`/couple/${link.id}/accept`), tr("Convite aceito"))}
              disabled={busy}
              data-testid="couple-accept"
            >
              {tr("Aceitar")}
            </Button>
            <Button
              variant="outline"
              onClick={() => run(() => api.post(`/couple/${link.id}/decline`), tr("Convite recusado"))}
              disabled={busy}
              data-testid="couple-decline"
            >
              {tr("Recusar")}
            </Button>
          </div>
        </div>
      )}

      {!loading && link?.status === "pending" && direction === "outgoing" && (
        <div className="max-w-md space-y-3 rounded-2xl border border-[#E5E4E0] p-5" data-testid="couple-outgoing">
          <p>{tr("Convite enviado para {name}. Aguardando resposta.", { name: partnerName })}</p>
          <Button
            variant="outline"
            onClick={() => run(() => api.post(`/couple/${link.id}/cancel`), tr("Convite cancelado"))}
            disabled={busy}
            data-testid="couple-cancel"
          >
            {tr("Cancelar convite")}
          </Button>
        </div>
      )}

      {!loading && link?.status === "active" && (
        <>
          <div className="max-w-md space-y-3 rounded-2xl border border-[#E5E4E0] p-5" data-testid="couple-active">
            <p>{tr("Vocês estão conectados com {name}.", { name: partnerName })}</p>
            <p className="text-xs text-[#6B7068]">
              {tr("Ao encerrar, o grupo e o histórico de acertos são mantidos.")}
            </p>
            <Button variant="outline" onClick={() => setConfirmEnd(true)} disabled={busy} data-testid="couple-end">
              {tr("Encerrar vínculo")}
            </Button>
          </div>
          <SharedBills partnerName={partnerName} onChanged={load} />
        </>
      )}

      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title={tr("Encerrar vínculo de casal?")}
        description={tr("O vínculo será encerrado para as duas pessoas. Nada será apagado.")}
        confirmLabel={tr("Encerrar")}
        variant="danger"
        onConfirm={() => {
          setConfirmEnd(false);
          run(() => api.post("/couple/end"), tr("Vínculo encerrado"));
        }}
        testId="couple-end-confirm"
      />
    </div>
  );
}
