import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";

/**
 * Banner não-intrusivo que sugere instalar o Aura Finance como app.
 * - Android/Chrome: usa o evento beforeinstallprompt (instalação 1-clique).
 * - iOS Safari: mostra instrução manual (Compartilhar → Adicionar à Tela Inicial).
 * - Esconde quando já está em modo standalone (já instalado).
 * - Pode ser dispensado por 14 dias via localStorage.
 */
const DISMISS_KEY = "aura_pwa_dismissed_at";
const LEGACY_DISMISS_KEY = "aurea_pwa_dismissed_at";
const DISMISS_DAYS = 14;

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isDismissed() {
  try {
    const ts = parseInt(
      localStorage.getItem(DISMISS_KEY) || localStorage.getItem(LEGACY_DISMISS_KEY) || "0",
      10,
    );
    if (!ts) return false;
    const days = (Date.now() - ts) / 86400000;
    return days < DISMISS_DAYS;
  } catch (_) { return false; }
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || isDismissed()) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS Safari não suporta beforeinstallprompt — mostra hint manual
    if (isIOS()) {
      // espera 3s para não atrapalhar o primeiro carregamento
      const t = setTimeout(() => { setIosHint(true); setShow(true); }, 3000);
      return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", handler); };
    }

    window.addEventListener("appinstalled", () => setShow(false));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (_) { /* ignore */ }
    setDeferred(null);
    setShow(false);
  };

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (_) { /* ignore */ }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      data-testid="install-prompt"
      className="fixed inset-x-3 md:left-auto md:right-4 md:bottom-20 bottom-3 md:max-w-sm z-[9998] card-soft shadow-xl border border-[#E5E4E0] flex items-start gap-3 p-4 animate-in slide-in-from-bottom-3"
      style={{ background: "#1E3F33", color: "white" }}
    >
      <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
        <Download size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold" style={{ fontFamily: "Outfit" }}>Instalar Aura Finance</div>
        {iosHint ? (
          <div className="text-sm opacity-90 mt-0.5">
            Toque em <Share size={14} className="inline mb-1" /> abaixo e depois em <strong>“Adicionar à Tela de Início”</strong> para abrir como um app.
          </div>
        ) : (
          <div className="text-sm opacity-90 mt-0.5">
            Adicione à tela inicial e use como um app. Abre em tela cheia, sem barra do navegador.
          </div>
        )}
        {!iosHint && (
          <button
            onClick={install}
            data-testid="install-btn"
            className="mt-2 inline-flex items-center gap-1.5 bg-white text-[#1E3F33] px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-[#F1EFE7]"
          >
            <Download size={14} /> Instalar agora
          </button>
        )}
      </div>
      <button
        onClick={dismiss}
        data-testid="install-dismiss"
        title="Agora não"
        className="text-white/70 hover:text-white p-1 -mr-1"
      >
        <X size={16} />
      </button>
    </div>
  );
}
