import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { aiError, PLAN_STATUS, ACCESS_TYPES } from "@/lib/aiAssistant";
import { translate as tr } from "@/i18n";

export default function AdminAI() {
  const [plans, setPlans] = useState(null);
  const [master, setMaster] = useState(null);
  const [masterLimit, setMasterLimit] = useState("300");
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(null);
  const [hours, setHours] = useState("24");
  const [limit, setLimit] = useState("20");
  const [payment, setPayment] = useState(false);
  const flight = useRef(false);
  const load = async () => {
    const [plansResult, masterResult] = await Promise.all([api.get("/admin/ai/plans"), api.get("/admin/ai/master-settings")]);
    setPlans(plansResult.data); setMaster(masterResult.data); setMasterLimit(String(masterResult.data.command_limit));
  };
  useEffect(() => { load().catch(error => toast.error(aiError(error))); }, []);
  const saveMasterLimit = async event => {
    event.preventDefault();
    const value = Number(masterLimit);
    if (flight.current || !Number.isInteger(value) || value < 1 || value > 1000000) return;
    flight.current = true; setBusy(true);
    try {
      const { data } = await api.put("/admin/ai/master-settings", { command_limit: value });
      setMaster(data); setMasterLimit(String(data.command_limit)); toast.success(tr("Atualizado"));
    } catch (error) { toast.error(aiError(error)); }
    finally { flight.current = false; setBusy(false); }
  };
  const openDecision = (plan, action, accessType = "paid") => {
    setHours(accessType === "courtesy" ? "720" : "24");
    setLimit(String(action === "adjust" ? plan.command_limit || 300 : accessType === "trial" ? 20 : 300));
    setPayment(false); setDecision({ plan, action, accessType });
  };
  const free = decision?.action === "approve" && decision?.accessType !== "paid";
  const adjusting = decision?.action === "adjust";
  const paid = decision?.action === "approve" && decision?.accessType === "paid";
  const valid = (!paid || payment) && (!(free || adjusting) || (
    Number.isInteger(Number(hours)) && Number(hours) >= 1 && Number(hours) <= 8760 &&
    Number.isInteger(Number(limit)) && Number(limit) >= 1 && Number(limit) <= 300
  ));
  const act = async event => {
    event.preventDefault();
    if (!decision || flight.current || !valid) return;
    flight.current = true; setBusy(true);
    try {
      await api.post(`/admin/ai/plans/${decision.plan.user_id}`, {
        request_id: decision.plan.request_id, action: decision.action,
        access_type: decision.accessType, payment_confirmed: paid && payment,
        ...((free || adjusting) ? { duration_hours: Number(hours), command_limit: Number(limit) } : {}),
        ...(adjusting ? { expected_version: decision.plan.access_version || "legacy" } : {}),
      });
      setDecision(null); await load(); toast.success(tr("Atualizado"));
    } catch (error) { toast.error(aiError(error)); await load().catch(() => {}); }
    finally { flight.current = false; setBusy(false); }
  };
  return <div className="max-w-3xl space-y-5">
    <h1 className="text-3xl font-semibold">{tr("Administrar planos de IA")}</h1>
    <p>{tr("Escolha teste gratuito, cortesia ou plano pago para cada solicitação. O acesso vence automaticamente.")}</p>
    {master && <form id="master-limit" className="card-soft space-y-3" onSubmit={saveMasterLimit}>
      <h2 className="text-xl font-semibold">{tr("Meu limite da IA do Aura")}</h2>
      <p>{tr("Comandos utilizados")}: {master.used || 0} / {master.command_limit}</p>
      <label className="block" htmlFor="master-command-limit">{tr("Limite mensal de comandos")}</label>
      <Input id="master-command-limit" type="number" min={1} max={1000000} step={1} value={masterLimit} onChange={event => setMasterLimit(event.target.value)} disabled={busy} required />
      <p className="text-sm">{tr("Você pode aumentar ou reduzir seu limite. O uso já registrado não será zerado, e o valor escolhido permanece nos próximos meses.")}</p>
      <p className="text-sm">{tr("Aumentar o limite permite mais consumo na chave da IA do Aura.")}</p>
      <Button type="submit" disabled={busy || !Number.isInteger(Number(masterLimit)) || Number(masterLimit) < 1 || Number(masterLimit) > 1000000}>{tr("Salvar meu limite")}</Button>
    </form>}
    <Button variant="outline" disabled={busy} onClick={() => load().catch(error => toast.error(aiError(error)))}>{tr("Atualizar")}</Button>
    {!plans && <p role="status">{tr("Carregando...")}</p>}
    {plans?.length === 0 && <p>{tr("Nenhuma solicitação de IA.")}</p>}
    {plans?.map(plan => <article className="card-soft space-y-3" key={plan.user_id}>
      <h2 className="font-semibold break-words">{plan.name} · {plan.email}</h2>
      <p>{tr("Status")}: {plan.effective_status === "expired" ? tr("Vencido") : plan.effective_status === "exhausted" ? tr("Limite atingido") : tr(PLAN_STATUS[plan.status] || "Aguardando")}</p>
      {plan.starts_at && <p>{tr("Tipo de acesso")}: {tr(ACCESS_TYPES[plan.access_type] || "Plano pago")}</p>}
      <p className="text-sm">{tr("Comandos utilizados")}: {plan.used || 0} / {plan.command_limit || 300}</p>
      {plan.requested_at && <p>{tr("Solicitado em")}: {new Date(plan.requested_at).toLocaleString()}</p>}
      {plan.reference && <p className="break-words">{tr("Referência do pagamento (opcional)")}: {plan.reference}</p>}
      {plan.expires_at && <p>{tr("Validade")}: {new Date(plan.expires_at).toLocaleString()}</p>}
      <div className="flex flex-wrap gap-2">
        {["pending", "payment_required", "payment_reported"].includes(plan.status) && <>
          <Button disabled={busy} onClick={() => openDecision(plan, "approve", "trial")}>{tr("Liberar teste gratuito")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => openDecision(plan, "approve", "courtesy")}>{tr("Liberar cortesia")}</Button>
          {plan.status === "pending" && <Button variant="outline" disabled={busy} onClick={() => openDecision(plan, "request_payment")}>{tr("Solicitar pagamento — €5")}</Button>}
          <Button variant="outline" disabled={busy} onClick={() => openDecision(plan, "approve")}>{tr("Confirmar pagamento e ativar")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => openDecision(plan, "reject")}>{tr("Rejeitar")}</Button>
        </>}
        {plan.status === "active" && <>
          {new Date(plan.expires_at) > new Date() && <Button variant="outline" disabled={busy} onClick={() => openDecision(plan, "adjust", plan.access_type)}>{tr("Alterar prazo e limite")}</Button>}
          <Button variant="outline" disabled={busy} onClick={() => openDecision(plan, "suspend")}>{tr("Suspender plano")}</Button>
        </>}
      </div>
    </article>)}
    <Dialog open={!!decision} onOpenChange={open => { if (!busy && !open) setDecision(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{paid ? tr("Confirmar pagamento e ativar") : adjusting ? tr("Alterar prazo e limite") : free ? tr(ACCESS_TYPES[decision.accessType]) : tr("Alterar o status deste plano?")}</DialogTitle></DialogHeader>
        <form onSubmit={act} className="space-y-4">
          <p className="break-words">{decision?.plan.email}</p>
          {(free || adjusting) && <>
            <label className="block" htmlFor="grant-hours">{adjusting ? tr("Nova validade a partir de agora (horas)") : tr("Duração a partir da aprovação (horas)")}</label>
            <Input id="grant-hours" type="number" min={1} max={8760} step={1} value={hours} onChange={event => setHours(event.target.value)} disabled={busy} required />
            <label className="block" htmlFor="grant-limit">{tr("Limite total de comandos")}</label>
            <Input id="grant-limit" type="number" min={1} max={300} step={1} value={limit} onChange={event => setLimit(event.target.value)} disabled={busy} required />
            <p className="text-sm">{adjusting ? tr("O uso atual não será zerado. Reduzir o limite abaixo do uso bloqueia novas consultas.") : tr("O acesso começa ao confirmar e termina no prazo definido ou quando atingir o limite.")}</p>
          </>}
          {paid && <label className="flex items-start gap-2"><input type="checkbox" checked={payment} onChange={event => setPayment(event.target.checked)} disabled={busy} />{tr("Confirmo o recebimento de €5 para um mês com 300 comandos.")}</label>}
          {decision?.action === "request_payment" && <p>{tr("O usuário receberá uma notificação para consultar as instruções de pagamento. O acesso ainda não será ativado.")}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDecision(null)}>{tr("Cancelar")}</Button>
            <Button type="submit" disabled={busy || !valid}>{busy ? tr("Salvando...") : tr("Confirmar")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
