/**
 * Registra o service worker da PWA quando suportado.
 * Só roda em produção para não interferir com hot-reload do CRA em dev.
 */
export function registerSW() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Apenas em produção (CRA serve dev sem precisar de SW)
  if (process.env.NODE_ENV !== "production") return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((reg) => {
        // Quando uma nova versão estiver pronta, ativa imediatamente
        if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              // Nova versão instalada; força ativação
              sw.postMessage("SKIP_WAITING");
            }
          });
        });
      })
      .catch((err) => {
        // Silencioso — PWA é progressive enhancement, app funciona sem SW
        console.warn("[Aura Finance] SW registration failed:", err);
      });

    // Reload uma única vez quando o SW novo assumir controle
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}
