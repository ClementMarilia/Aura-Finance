import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Sparkles } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import VoiceEntry from "@/components/VoiceEntry";
import { Button } from "@/components/ui/button";
import { aiError, localToday } from "@/lib/aiAssistant";
import { parseVoiceEntry } from "@/lib/voiceEntry";
import { startRecording } from "@/lib/aiRecorder";
import { getLanguage, translate as tr } from "@/i18n";

export default function AIEntry({ onResult, onBasicResult, expandInitially = false }) {
  const [expanded, setExpanded] = useState(expandInitially);
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [config, setConfig] = useState(null);
  const panelId = useId();
  const recorder = useRef(null);
  const alive = useRef(true);
  const flight = useRef(false);
  useEffect(() => {
    alive.current = true;
    api.get("/ai/settings").then(({ data }) => { if (alive.current) setConfig(data); }).catch(() => {});
    return () => { alive.current = false; recorder.current?.cancel(); };
  }, []);

  // Open automatically when the mobile quick-add voice action was selected.
  useEffect(() => { if (expandInitially) setExpanded(true); }, [expandInitially]);

  const interpret = async (input) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setErrorMessage("");
    try {
      const { data } = await api.post("/ai/interpret", { ...input, today: localToday(), language: getLanguage() }, { timeout: 95000 });
      if (!alive.current) return;
      onResult(data.draft);
      setQuestion(data.draft.question || "");
      if (data.draft.question) toast.info(data.draft.question);
      else toast.success(tr("Ouvi e preenchi. Confira antes de salvar."));
    } catch (error) {
      if (alive.current) { setErrorMessage(aiError(error)); toast.error(aiError(error)); }
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

  return <section className="rounded-xl border p-3" aria-label={tr("Assistente com IA")}>
    <div className="flex items-center gap-2">
      <button type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded} aria-controls={panelId}
        disabled={recording || starting} onClick={() => setExpanded(value => !value)}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#00C9A7]/15 text-[#00B89A]">
          <Sparkles size={18} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-sm leading-tight">{tr("Assistente com IA")}</strong>
          <span className="block text-xs text-muted-foreground">{tr("Opcional: use IA para preencher mais rápido.")}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className={"shrink-0 transition-transform " + (expanded ? "rotate-180" : "")} />
      </button>
      <Link className="shrink-0 text-xs underline underline-offset-2" to="/configuracoes/ia">{tr("Configurar IA")}</Link>
    </div>
    {expanded && <div id={panelId} className="mt-3 space-y-3 border-t pt-3">
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
      {errorMessage && <div role="alert" className="rounded-lg border p-2 space-y-2 text-sm">
        <p>{errorMessage}</p>
        <p className="text-xs text-muted-foreground">{tr("Você pode continuar pelo formulário. Seu texto foi mantido; nenhum lançamento foi salvo.")}</p>
        {text.trim() && onBasicResult && <Button type="button" variant="outline" disabled={busy || recording} onClick={() => {
          onBasicResult(parseVoiceEntry(text));
          setQuestion(tr("Confira valor, data, categoria e conta antes de salvar."));
          setErrorMessage("");
        }}>{tr("Usar preenchimento básico sem IA")}</Button>}
      </div>}
      {question && <p role="status" className="text-sm">{question}</p>}
      <p className="text-xs">{tr("Cada interpretação concluída usa um comando. Revise antes de salvar.")}</p>
      <p className="text-xs">{tr("O texto ou áudio e os nomes das suas categorias e contas serão enviados ao provedor escolhido.")}</p>
    </> : <><p className="text-sm">{tr("Conecte sua própria IA ou solicite o Plano IA Aura de €5/mês.")}</p>
      {onBasicResult && <VoiceEntry onResult={onBasicResult} />}</>}
    </div>}
  </section>;
}
