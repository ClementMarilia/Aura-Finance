import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aiError, PLAN_STATUS } from "@/lib/aiAssistant";
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
  const plan = config?.plan;
  const active = plan?.status === "active" && new Date(plan.expires_at) > new Date();
  const waiting = ["pending", "payment_reported"].includes(plan?.status);
  if (!config) return <p role="status">{tr("Carregando...")}</p>;
  return <div className="max-w-2xl space-y-6">
    <h1 className="text-3xl font-semibold">{tr("Inteligência artificial")}</h1>
    <p>{tr("Escolha sua própria conexão ou contrate a IA oferecida pelo Aura.")}</p>
    {user?.is_super_admin && <Button asChild variant="outline"><Link to="/admin/ia">{tr("Administrar planos de IA")}</Link></Button>}
    <form className="card-soft space-y-4" onSubmit={event => { event.preventDefault(); run(async () => {
      await api.put("/ai/settings", { source, provider, model: model || config.default_models?.[provider], consent: true, ...(key ? { key } : {}) });
      setKey(""); setConsent(false);
    }); }}>
      <label className="block" htmlFor="ai-source">{tr("Conexão de IA")}</label>
      <select id="ai-source" className="w-full border rounded-lg p-2 bg-transparent" value={source} onChange={event => setSource(event.target.value)} disabled={busy}>
        <option value="off">{tr("Desativada")}</option><option value="own">{tr("Minha própria IA")}</option>
        <option value="aura">{tr("Plano IA Aura — €5/mês")}</option>
      </select>
      {source === "own" && <>
        {!config.ready && <p role="alert">{tr("A IA ainda não foi configurada pela administradora.")}</p>}
        <label className="block" htmlFor="ai-provider">{tr("Provedor")}</label>
        <select id="ai-provider" className="w-full border rounded-lg p-2 bg-transparent" value={provider} onChange={event => { setProvider(event.target.value); setModel(config.default_models?.[event.target.value] || ""); setKey(""); }} disabled={busy}>
          <option value="gemini">Gemini</option><option value="openai">OpenAI</option>
        </select>
        <label className="block" htmlFor="ai-model">{tr("Modelo de IA")}</label>
        <select id="ai-model" className="w-full border rounded-lg p-2 bg-transparent" value={model} onChange={event => setModel(event.target.value)} disabled={busy}>
          {(config.models?.[provider] || []).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <label className="block" htmlFor="ai-key">{tr("Chave de API")}</label>
        <Input id="ai-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} maxLength={512} disabled={busy} />
        <p className="text-sm">{config.has_key ? tr("Existe uma chave salva. Deixe vazio para mantê-la no mesmo provedor.") : tr("Crie sua chave na plataforma do provedor e cole aqui.")}</p>
        <div className="flex gap-4 text-sm underline"><a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Google AI Studio</a>
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI API</a></div>
        <p className="text-sm">{tr("Limites e cobranças são da sua conta no provedor. Uma assinatura de chat não garante acesso à API.")}</p>
        <p className="text-sm">{tr("A modalidade gratuita do Gemini tem limites e regras próprias de uso de dados. Confira os termos do provedor.")}</p>
      </>}
      {source === "aura" && <p>{tr("Ative a conexão após a aprovação do pagamento. O plano usa o provedor definido pela administradora.")}</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />
        {tr("Autorizo enviar meus comandos e nomes de categorias e contas ao provedor escolhido. A chave será armazenada criptografada.")}</label>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !consent || (source === "own" && !config.ready)}>{tr("Salvar conexão")}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => run(async () => { await api.delete("/ai/settings"); setKey(""); })}>{tr("Desconectar e apagar chave")}</Button></div>
    </form>
    <section className="card-soft space-y-4">
      <h2 className="text-xl font-semibold">{tr("Plano IA Aura — €5/mês")}</h2>
      <p>{tr("300 comandos por mês, por texto ou áudio de até 30 segundos. Sem renovação automática.")}</p>
      <p className="text-sm">{tr("A mensalidade dá acesso ao serviço. Não é saldo de créditos no provedor.")}</p>
      {!config.aura_available && <p role="alert">{tr("A IA ainda não foi configurada pela administradora.")}</p>}
      {plan && <div className="space-y-2" role="status">
        <p>{tr("Status")}: {plan.status === "active" && !active ? tr("Vencido") : tr(PLAN_STATUS[plan.status] || "Aguardando")}</p>
        {plan.expires_at && <p>{tr("Validade")}: {new Date(plan.expires_at).toLocaleDateString()}</p>}
        {active && <><p>{tr("Comandos utilizados")}: {plan.used || 0} / 300</p>
          <progress className="w-full" aria-label={tr("Comandos utilizados")} value={plan.used || 0} max={300} /></>}
        {active && plan.attempts >= 360 && <p>{tr("Limite de tentativas atingido. Entre em contato com a administradora.")}</p>}
      </div>}
      <p className="whitespace-pre-wrap text-sm">{config.payment_instructions || tr("As instruções de pagamento ainda não foram configuradas.")}</p>
      {!active && !waiting && <Button disabled={busy || !config.aura_available || !config.payment_instructions} onClick={() => run(() => api.post("/ai/plan/request"))}>{tr("Solicitar plano — €5/mês")}</Button>}
      {plan?.status === "pending" && <>
        <label className="block" htmlFor="ai-reference">{tr("Referência do pagamento (opcional)")}</label>
        <Input id="ai-reference" maxLength={160} value={reference} onChange={event => setReference(event.target.value)} disabled={busy} />
        <Button disabled={busy} onClick={() => run(() => api.post("/ai/plan/payment", { request_id: plan.request_id, reference }))}>{tr("Já realizei o pagamento")}</Button>
      </>}
      <p className="text-sm">{tr("Informar o pagamento não ativa o plano. A administradora precisa confirmar o recebimento.")}</p>
    </section>
    <Button asChild variant="outline"><Link to="/lancamentos?novo=1">{tr("Testar nos lançamentos")}</Link></Button>
  </div>;
}
