import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseVoiceEntry } from "@/lib/voiceEntry";
import { getLocale, translate as tr } from "@/i18n";

const Recognition = typeof window !== "undefined"
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

// Dictates one sentence ("gastei 35 reais no mercado") and reports
// { amount, type, description }. `autoStart` begins listening as soon as the
// form opens, for the "falar" shortcut on the quick-add menu.
export default function VoiceEntry({ onResult, autoStart = false }) {
  const recognition = useRef(null);
  const [listening, setListening] = useState(false);

  const start = () => {
    if (!Recognition) return;
    const instance = new Recognition();
    instance.lang = getLocale();
    instance.interimResults = false;
    instance.maxAlternatives = 1;
    instance.onresult = (event) => {
      const parsed = parseVoiceEntry(event.results?.[0]?.[0]?.transcript);
      if (!parsed.amount && !parsed.description) {
        toast.error(tr("Não entendi. Tente algo como: gastei 35 reais no mercado."));
        return;
      }
      onResult(parsed);
      toast.success(tr("Ouvi e preenchi. Confira antes de salvar."));
    };
    instance.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error(tr("Permita o microfone para falar o lançamento."));
      } else if (event.error !== "aborted" && event.error !== "no-speech") {
        toast.error(tr("Não foi possível ouvir agora. Tente de novo."));
      }
    };
    instance.onend = () => setListening(false);
    recognition.current = instance;
    setListening(true);
    try {
      instance.start();
    } catch {
      setListening(false);
    }
  };

  useEffect(() => {
    if (autoStart) start();
    return () => recognition.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!Recognition) return null;
  return (
    <Button type="button" variant="outline" className="w-full rounded-xl" data-testid="voice-entry-button"
      aria-pressed={listening}
      onClick={() => (listening ? recognition.current?.stop() : start())}>
      <Mic size={16} className={`mr-2 ${listening ? "animate-pulse text-red-500" : ""}`} />
      {listening ? tr("Ouvindo... fale agora") : tr("Falar o lançamento")}
    </Button>
  );
}
