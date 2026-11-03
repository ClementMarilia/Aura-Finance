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
// { amount, type, description }. Listening starts only from this button so the
// browser can request microphone access during a direct user action.
export default function VoiceEntry({ onResult }) {
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
      setListening(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error(tr("O microfone está bloqueado para este site. Libere a permissão nas configurações do navegador e tente novamente."));
      } else if (event.error === "no-speech") {
        toast.error(tr("Não ouvi nenhuma fala. Toque no microfone e fale novamente."));
      } else if (event.error !== "aborted") {
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
      toast.error(tr("Não foi possível ouvir agora. Tente de novo."));
    }
  };

  useEffect(() => {
    return () => recognition.current?.abort();
  }, []);

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
