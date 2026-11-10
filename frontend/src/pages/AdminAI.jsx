import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ConfirmDialog";
import { aiError, PLAN_STATUS } from "@/lib/aiAssistant";
import { translate as tr } from "@/i18n";

export default function AdminAI() {
  const [plans, setPlans] = useState(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(null);
  const flight = useRef(false);
  const load = async () => { const { data } = await api.get("/admin/ai/plans"); setPlans(data); };
  useEffect(() => { load().catch(error => toast.error(aiError(error))); }, []);
  const act = async () => {
    if (!decision || flight.current) return;
    flight.current = true; setBusy(true);
    try {
      await api.post(`/admin/ai/plans/${decision.plan.user_id}`, {
        request_id: decision.plan.request_id, action: decision.action, payment_confirmed: decision.action === "approve",
      });
      setDecision(null); await load(); toast.success(tr("Atualizado"));
    } catch (error) { toast.error(aiError(error)); }
    finally { flight.current = false; setBusy(false); }
  };
  return <div className="max-w-3xl space-y-5">
    <h1 className="text-3xl font-semibold">{tr("Administrar planos de IA")}</h1>
    <p>{tr("Confirme o pagamento de €5 antes de ativar um mês de acesso. Aprovar duas vezes não renova o plano.")}</p>
    <Button variant="outline" disabled={busy} onClick={() => load().catch(error => toast.error(aiError(error)))}>{tr("Atualizar")}</Button>
    {!plans && <p role="status">{tr("Carregando...")}</p>}
    {plans?.length === 0 && <p>{tr("Nenhuma solicitação de IA.")}</p>}
    {plans?.map(plan => <article className="card-soft space-y-3" key={plan.user_id}>
      <h2 className="font-semibold break-words">{plan.name} · {plan.email}</h2>
      <p>{tr("Status")}: {plan.status === "active" && new Date(plan.expires_at) <= new Date() ? tr("Vencido") : tr(PLAN_STATUS[plan.status] || "Aguardando")}</p>
      <p className="text-sm">{tr("Comandos utilizados")}: {plan.used || 0} / 300</p>
      {plan.requested_at && <p>{tr("Solicitado em")}: {new Date(plan.requested_at).toLocaleString()}</p>}
      {plan.reference && <p className="break-words">{tr("Referência do pagamento (opcional)")}: {plan.reference}</p>}
      {plan.expires_at && <p>{tr("Validade")}: {new Date(plan.expires_at).toLocaleString()}</p>}
      <div className="flex flex-wrap gap-2">
        {["pending", "payment_reported"].includes(plan.status) && <>
          <Button disabled={busy} onClick={() => setDecision({ plan, action: "approve" })}>{tr("Confirmar pagamento e ativar")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => setDecision({ plan, action: "reject" })}>{tr("Rejeitar")}</Button>
        </>}
        {plan.status === "active" && <Button variant="outline" disabled={busy} onClick={() => setDecision({ plan, action: "suspend" })}>{tr("Suspender plano")}</Button>}
      </div>
    </article>)}
    <ConfirmDialog open={!!decision} onOpenChange={open => { if (!busy && !open) setDecision(null); }}
      title={decision?.action === "approve" ? tr("Confirma que recebeu €5 deste usuário?") : tr("Alterar o status deste plano?")}
      description={decision?.action === "approve" ? tr("O acesso começa agora e vence em um mês, com 300 comandos.") : tr("Esta ação altera o acesso à IA oferecida pelo Aura.")}
      onConfirm={act} confirmLabel={busy ? tr("Salvando...") : tr("Confirmar")} variant="primary" />
  </div>;
}
