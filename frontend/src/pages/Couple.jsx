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
        <div className="max-w-md space-y-3 rounded-2xl border border-[#E5E4E0] p-5" data-testid="couple-active">
          <p>{tr("Vocês estão conectados com {name}.", { name: partnerName })}</p>
          <p className="text-xs text-[#6B7068]">
            {tr("Ao encerrar, o grupo e o histórico de acertos são mantidos.")}
          </p>
          <Button variant="outline" onClick={() => setConfirmEnd(true)} disabled={busy} data-testid="couple-end">
            {tr("Encerrar vínculo")}
          </Button>
        </div>
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
