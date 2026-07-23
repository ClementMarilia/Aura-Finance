import { useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { usePWAUpdate } from "@/context/PWAUpdateContext";
import { translate as tr } from "@/i18n";

export default function PWAUpdatePrompt() {
  const { updateAvailable, applying, applyUpdate } = usePWAUpdate();
  const [dismissed, setDismissed] = useState(false);

  if (!updateAvailable || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-update-prompt"
      className="fixed inset-x-3 bottom-3 z-[9999] flex items-start gap-3 rounded-2xl border border-white/15 bg-[#061B4A] p-4 text-white shadow-2xl md:bottom-5 md:left-auto md:right-5 md:max-w-md"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/15">
        <RefreshCw size={20} className={applying ? "animate-spin" : ""} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold" style={{ fontFamily: "Outfit" }}>
          {tr("Nova versão disponível")}
        </div>
        <p className="mt-0.5 text-sm text-white/85">
          {tr("Salve o que estiver preenchendo e atualize para usar as novidades.")}
        </p>
        <button
          type="button"
          onClick={applyUpdate}
          disabled={applying}
          data-testid="pwa-update-apply"
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-[#061B4A] transition hover:bg-[#E9F6F7] disabled:cursor-wait disabled:opacity-70"
        >
          <RefreshCw size={14} className={applying ? "animate-spin" : ""} />
          {applying ? tr("Atualizando...") : tr("Atualizar agora")}
        </button>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        data-testid="pwa-update-dismiss"
        title={tr("Lembrar depois")}
        aria-label={tr("Lembrar depois")}
        className="-mr-1 p-1 text-white/70 transition hover:text-white"
      >
        <X size={17} />
      </button>
    </div>
  );
}
