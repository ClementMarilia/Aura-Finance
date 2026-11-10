import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import api from "@/lib/api";
import VoiceEntry from "@/components/VoiceEntry";
import { Button } from "@/components/ui/button";
import { aiError, localToday } from "@/lib/aiAssistant";
import { startRecording } from "@/lib/aiRecorder";
import { getLanguage, translate as tr } from "@/i18n";

export default function AIEntry({ onResult, onBasicResult }) {
  const [text, setText] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [config, setConfig] = useState(null);
  const recorder = useRef(null);
  const alive = useRef(true);
  const flight = useRef(false);
  useEffect(() => {
    alive.current = true;
    api.get("/ai/settings").then(({ data }) => { if (alive.current) setConfig(data); }).catch(() => {});
    return () => { alive.current = false; recorder.current?.cancel(); };
  }, []);

  const interpret = async (input) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const { data } = await api.post("/ai/interpret", { ...input, today: localToday(), language: getLanguage() }, { timeout: 95000 });
      if (!alive.current) return;
      onResult(data.draft);
      setQuestion(data.draft.question || "");
      if (data.draft.question) toast.info(data.draft.question);
      else toast.success(tr("Ouvi e preenchi. Confira antes de salvar."));
    } catch (error) {
      if (alive.current) toast.error(aiError(error));
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const record = async () => {
    if (recording) { await recorder.current?.stop(); return; }
    setStarting(true);
    try {
      const instance = await startRecording(audio => {
        if (!alive.current) return;
        setRecording(false);
        interpret({ audio });
      });
      if (!alive.current) { await instance.cancel(); return; }
      recorder.current = instance;
      setRecording(true);
    } catch {
      if (alive.current) toast.error(tr("Não foi possível gravar. Confira a permissão do microfone."));
    } finally { if (alive.current) setStarting(false); }
  };

  return <section className="rounded-xl border p-3 space-y-3" aria-label={tr("Assistente de lançamentos")}>
    <div className="flex justify-between gap-2 text-sm"><strong>{tr("Assistente de lançamentos")}</strong>
      <Link className="underline" to="/configuracoes/ia">{tr("Configurar IA")}</Link></div>
    {config?.source && config.source !== "off" ? <>
      <label className="block text-sm" htmlFor="ai-command">{tr("Descreva uma receita ou despesa")}</label>
      <textarea id="ai-command" className="w-full rounded-lg border p-2 bg-transparent" maxLength={1500}
        value={text} onChange={event => setText(event.target.value)} disabled={busy || recording || starting} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || recording || starting || !text.trim()} onClick={() => interpret({ text: text.trim() })}>
          {busy ? tr("Interpretando...") : tr("Preencher com IA")}</Button>
        <Button type="button" variant="outline" disabled={busy || starting} aria-pressed={recording} onClick={record}>
          {recording ? tr("Parar e interpretar") : tr("Gravar até 30 segundos")}</Button>
      </div>
      <p role="status" className="text-sm">{question}</p>
      <p className="text-xs">{tr("Cada interpretação concluída usa um comando. Revise antes de salvar.")}</p>
      <p className="text-xs">{tr("O texto ou áudio e os nomes das suas categorias e contas serão enviados ao provedor escolhido.")}</p>
    </> : <><p className="text-sm">{tr("Conecte sua própria IA ou solicite o Plano IA Aura de €5/mês.")}</p>
      {onBasicResult && <VoiceEntry onResult={onBasicResult} />}</>}
  </section>;
}
