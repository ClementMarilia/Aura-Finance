import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aiError, PLAN_STATUS, ACCESS_TYPES } from "@/lib/aiAssistant";
import { translate as tr } from "@/i18n";

export default function AISettings() {
  const { user } = useAuth();
  const [config, setConfig] = useState(null);
  const [source, setSource] = useState("off");
  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [consent, setConsent] = useState(false);
  const [reference, setReference] = useState("");
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const load = async () => {
    const { data } = await api.get("/ai/settings");
    setConfig(data); setSource(data.source); setProvider(data.provider); setModel(data.model || data.default_models?.[data.provider] || "");
  };
  useEffect(() => { load().catch(error => toast.error(aiError(error))); }, []);
  const run = async action => {
    if (flight.current) return;
    flight.current = true; setBusy(true);
    try { await action(); await load(); toast.success(tr("Atualizado")); }
    catch (error) { toast.error(aiError(error)); }
    finally { flight.current = false; setBusy(false); }
  };
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const plan = config?.plan;
  const active = plan?.status === "active" && new Date(plan.expires_at).getTime() > now;
  const waiting = ["pending", "payment_required", "payment_reported"].includes(plan?.status);
  if (!config) return <p role="status">{tr("Carregando...")}</p>;
  return <div className="max-w-2xl space-y-6">
    <h1 className="text-3xl font-semibold">{tr("Inteligência artificial")}</h1>
    <p>{tr("Escolha sua própria conexão ou contrate a IA oferecida pelo Aura.")}</p>
    {user?.is_super_admin && <Button asChild variant="outline"><Link to="/admin/ia">{tr("Administrar planos de IA")}</Link></Button>}
    <form className="card-soft space-y-4" onSubmit={event => { event.preventDefault(); run(async () => {
      await api.put("/ai/settings", { source, consent: true, ...(source === "own" ? {
        provider, model: model || config.default_models?.[provider], ...(key ? { key } : {}),
      } : {}) });
      setKey(""); setConsent(false);
    }); }}>
      <label className="block" htmlFor="ai-source">{tr("Conexão de IA")}</label>
      <select id="ai-source" className="w-full border rounded-lg p-2 bg-transparent" value={source} onChange={event => { setSource(event.target.value); setKey(""); }} disabled={busy}>
        <option value="off">{tr("Desativada")}</option><option value="own">{tr("Minha própria IA")}</option>
        <option value="aura">{tr("IA do Aura")}</option>
      </select>
      {source === "own" && <>
        {!config.ready && <p role="alert">{tr("A IA ainda não foi configurada pela administradora.")}</p>}
        <label className="block" htmlFor="ai-provider">{tr("Provedor")}</label>
        <select id="ai-provider" className="w-full border rounded-lg p-2 bg-transparent" value={provider} onChange={event => { setProvider(event.target.value); setModel(config.default_models?.[event.target.value] || ""); setKey(""); }} disabled={busy}>
          <option value="gemini">Gemini</option><option value="openai">OpenAI</option>
        </select>
        <label className="block" htmlFor="ai-model">{tr("Modelo de IA")}</label>
        <select id="ai-model" className="w-full border rounded-lg p-2 bg-transparent" value={model} onChange={event => setModel(event.target.value)} disabled={busy}>
          {(config.models?.[provider] || []).map(value => <option key={value} value={value}>{value === "auto" ? tr("Automático — encontrar modelo disponível") : value}</option>)}
        </select>
        <p className="text-sm">{tr("O modo automático procura modelos compatíveis no mesmo provedor. Não altera sua conta nem ativa cobrança.")}</p>
        {config.last_model && <p className="text-sm">{tr("Último modelo utilizado")}: {config.last_model}</p>}
        <label className="block" htmlFor="ai-key">{tr("Chave de API")}</label>
        <Input id="ai-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} maxLength={512} disabled={busy} />
        <p className="text-sm">{config.has_key ? tr("Existe uma chave salva. Deixe vazio para mantê-la no mesmo provedor.") : tr("Crie sua chave na plataforma do provedor e cole aqui.")}</p>
        <div className="flex gap-4 text-sm underline"><a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Google AI Studio</a>
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI API</a></div>
        <p className="text-sm">{tr("Limites e cobranças são da sua conta no provedor. Uma assinatura de chat não garante acesso à API.")}</p>
        <p className="text-sm">{tr("A modalidade gratuita do Gemini tem limites e regras próprias de uso de dados. Confira os termos do provedor.")}</p>
      </>}
      {source === "aura" && <p>{config.master_access ? tr("Seu acesso master não precisa de aprovação ou pagamento.") : tr("Ative a conexão após a aprovação do pagamento. O plano usa o provedor definido pela administradora.")}</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />
        {tr("Autorizo enviar meus comandos e nomes de categorias e contas ao provedor escolhido. A chave será armazenada criptografada.")}</label>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !consent || (source === "own" && !config.ready)}>{tr("Salvar conexão")}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => run(async () => { await api.delete("/ai/settings"); setKey(""); })}>{tr("Desconectar e apagar chave")}</Button></div>
    </form>
    {config.master_access ? <section className="card-soft space-y-4">
      <h2 className="text-xl font-semibold">{tr("Acesso master à IA do Aura")}</h2>
      <p>{tr("Seu acesso master não precisa de aprovação ou pagamento.")}</p>
      <p>{tr("Selecione IA do Aura e salve a conexão para usar. A chave do serviço deve estar configurada no servidor.")}</p>
      {!config.aura_available && <p role="alert">{tr("A IA ainda não foi configurada pela administradora.")}</p>}
      <p>{tr("Comandos utilizados")}: {plan?.used || 0} / {plan?.command_limit || 300}</p>
      <p>{tr("O controle de 300 comandos é renovado automaticamente a cada mês, sem reiniciar ao reconectar.")}</p>
      {plan?.expires_at && <p>{tr("Próxima renovação")}: {new Date(plan.expires_at).toLocaleString()}</p>}
    </section> : <section className="card-soft space-y-4">
      <h2 className="text-xl font-semibold">{tr("IA do Aura")}</h2>
      <p>{tr("Solicite acesso. A administradora pode liberar um teste gratuito, uma cortesia ou solicitar o pagamento do plano.")}</p>
      <p className="text-sm">{tr("Plano pago: €5 por mês, com 300 comandos e sem renovação automática.")}</p>
      {!config.aura_available && <p role="status">{tr("A IA ainda não foi configurada pela administradora.")}</p>}
      {plan && <div className="space-y-2" role="status">
        <p>{tr("Status")}: {plan.status === "active" && !active ? tr("Vencido") : plan.effective_status === "exhausted" ? tr("Limite atingido") : tr(PLAN_STATUS[plan.status] || "Aguardando")}</p>
        {plan.starts_at && <p>{tr("Tipo de acesso")}: {tr(ACCESS_TYPES[plan.access_type] || "Plano pago")}</p>}
        {plan.expires_at && <p>{tr("Validade")}: {new Date(plan.expires_at).toLocaleString()}</p>}
        {active && <><p>{tr("Comandos utilizados")}: {plan.used || 0} / {plan.command_limit || 300}</p>
          <p>{tr("Comandos restantes")}: {plan.remaining ?? Math.max(0, (plan.command_limit || 300) - (plan.used || 0))}</p>
          <progress className="w-full" aria-label={tr("Comandos utilizados")} value={plan.used || 0} max={plan.command_limit || 300} /></>}
        {active && plan.attempts >= (plan.attempt_limit || 360) && <p>{tr("Limite de tentativas atingido. Entre em contato com a administradora.")}</p>}
      </div>}
      {(!active || plan?.effective_status === "exhausted") && !waiting && <Button disabled={busy} onClick={() => run(() => api.post("/ai/plan/request"))}>{tr("Solicitar acesso à IA do Aura")}</Button>}
      {["payment_required", "payment_reported"].includes(plan?.status) && <p className="whitespace-pre-wrap text-sm">{config.payment_instructions || tr("As instruções de pagamento ainda não foram configuradas.")}</p>}
      {plan?.status === "payment_required" && <>
        <label className="block" htmlFor="ai-reference">{tr("Referência do pagamento (opcional)")}</label>
        <Input id="ai-reference" maxLength={160} value={reference} onChange={event => setReference(event.target.value)} disabled={busy} />
        <Button disabled={busy} onClick={() => run(() => api.post("/ai/plan/payment", { request_id: plan.request_id, reference }))}>{tr("Já realizei o pagamento")}</Button>
      </>}
      {waiting && <p className="text-sm">{tr("Sua solicitação foi enviada à administradora. O acesso depende de aprovação.")}</p>}
      <p className="text-sm">{tr("Ao vencer o prazo ou atingir o limite, somente a IA do Aura é bloqueada. Você pode continuar com sua própria IA.")}</p>
    </section>}
    <Button asChild variant="outline"><Link to="/lancamentos?novo=1">{tr("Testar nos lançamentos")}</Link></Button>
  </div>;
}
