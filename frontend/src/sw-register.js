import packageJson from "../package.json";

export const APP_VERSION = packageJson.version;

const listeners = new Set();
const trackedRegistrations = new WeakSet();

let registration = null;
let registrationPromise = null;
let waitingWorker = null;
let reloadRequested = false;
let refreshTimer = null;
let state = {
  supported:
    typeof navigator !== "undefined" && "serviceWorker" in navigator,
  registered: false,
  updateAvailable: false,
  checking: false,
  applying: false,
  lastCheckedAt: null,
  error: null,
};

function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
}

function markUpdateAvailable(reg, worker = reg.waiting) {
  registration = reg;
  waitingWorker = worker;
  emit({
    registered: true,
    updateAvailable: Boolean(worker),
    checking: false,
    error: null,
  });
}

function trackRegistration(reg) {
  registration = reg;
  emit({ registered: true, error: null });

  if (reg.waiting) markUpdateAvailable(reg, reg.waiting);
  if (trackedRegistrations.has(reg)) return;
  trackedRegistrations.add(reg);

  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    if (!worker) return;

    worker.addEventListener("statechange", () => {
      if (worker.state !== "installed") return;
      // Sem controller é a primeira instalação, não uma atualização.
      if (!navigator.serviceWorker.controller) return;
      markUpdateAvailable(reg, reg.waiting || worker);
    });
  });
}

async function ensureRegistration() {
  if (registration) return registration;
  if (!state.supported || process.env.NODE_ENV !== "production") return null;
  if (registrationPromise) return registrationPromise;

  registrationPromise = navigator.serviceWorker
    .register("/service-worker.js", { updateViaCache: "none" })
    .then((reg) => {
      trackRegistration(reg);
      return reg;
    })
    .catch((error) => {
      registrationPromise = null;
      emit({ registered: false, error });
      console.warn("[Crelith Finance] SW registration failed:", error);
      return null;
    });

  return registrationPromise;
}

function waitForInstall(worker) {
  if (!worker || ["installed", "activated", "redundant"].includes(worker.state)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onStateChange = () => {
      if (!["installed", "activated", "redundant"].includes(worker.state)) return;
      worker.removeEventListener("statechange", onStateChange);
      resolve();
    };
    worker.addEventListener("statechange", onStateChange);
  });
}

export function getSWUpdateState() {
  return state;
}

export function subscribeToSWUpdates(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function checkForSWUpdate({ silent = false } = {}) {
  if (!state.supported || process.env.NODE_ENV !== "production") {
    return { supported: false, updateAvailable: false };
  }

  if (!silent) emit({ checking: true, error: null });

  try {
    const reg = await ensureRegistration();
    if (!reg) {
      if (!silent) emit({ checking: false });
      return { supported: true, updateAvailable: false };
    }

    await reg.update();
    if (reg.installing) await waitForInstall(reg.installing);

    const availableWorker = reg.waiting || waitingWorker;
    const updateAvailable = Boolean(availableWorker);
    if (availableWorker) waitingWorker = availableWorker;
    emit({
      checking: false,
      updateAvailable,
      lastCheckedAt: Date.now(),
      error: null,
    });
    return { supported: true, updateAvailable };
  } catch (error) {
    emit({ checking: false, lastCheckedAt: Date.now(), error });
    return { supported: true, updateAvailable: false, error };
  }
}

export function applySWUpdate() {
  const worker = registration?.waiting || waitingWorker;
  if (!worker) return false;

  reloadRequested = true;
  emit({ applying: true, error: null });
  worker.postMessage({ type: "SKIP_WAITING" });
  return true;
}

/**
 * Registra a PWA e verifica atualizações:
 * - ao abrir o app;
 * - ao voltar para o app depois de alguns minutos;
 * - a cada hora enquanto ele estiver aberto.
 */
export function registerSW() {
  if (typeof window === "undefined" || !state.supported) return;
  if (process.env.NODE_ENV !== "production") return;

  const start = async () => {
    await ensureRegistration();
    await checkForSWUpdate({ silent: true });
  };

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });

  if (!refreshTimer) {
    refreshTimer = window.setInterval(
      () => checkForSWUpdate({ silent: true }),
      60 * 60 * 1000,
    );
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const stale =
      !state.lastCheckedAt || Date.now() - state.lastCheckedAt > 5 * 60 * 1000;
    if (stale) checkForSWUpdate({ silent: true });
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadRequested || refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
