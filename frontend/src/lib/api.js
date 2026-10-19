import axios from "axios";
import { getLocale, translate as tr } from "@/i18n";

// Production API traffic is proxied through the official frontend domain so
// the HttpOnly refresh cookie remains first-party. Development keeps the
// explicitly configured backend URL.
const BACKEND_URL = process.env.NODE_ENV === "production"
  ? ""
  : (process.env.REACT_APP_BACKEND_URL || "");
export const API = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API,
  withCredentials: true,
  headers: { "X-Requested-With": "CrelithFinance" },
});
const IDEMPOTENCY_STORAGE_KEY = "crelith.pending-create-requests";
let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token || null;
}

export function clearAccessToken() {
  accessToken = null;
  localStorage.removeItem("token"); // remove the legacy seven-day token once
}

const REFRESH_LOCK_NAME = "crelith-auth-refresh";
const REFRESH_CONFLICT_RETRIES = 4;

// The refresh cookie is rotated on every use and shared by all tabs. Holding a
// cross-tab lock until the response (and its Set-Cookie) is processed keeps a
// second tab from sending the already-rotated cookie.
function withRefreshLock(task) {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(REFRESH_LOCK_NAME, task);
  }
  return task();
}

async function postRefresh() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await axios.post(`${API}/auth/refresh`, null, {
        withCredentials: true,
        headers: { "X-Requested-With": "CrelithFinance" },
      });
    } catch (error) {
      // 409: another tab/device rotated the cookie within the backend's race window.
      if (error.response?.status !== 409 || attempt > REFRESH_CONFLICT_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = withRefreshLock(postRefresh).then(({ data }) => {
      setAccessToken(data.token);
      return data;
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export const CURRENCIES = [
  { value: "EUR", label: "EUR (€)" },
  { value: "BRL", label: "BRL (R$)" },
  { value: "USD", label: "USD ($)" },
  { value: "CHF", label: "CHF (Fr)" },
];

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const requestUrl = String(original?.url || "");
    const skipsRefresh = requestUrl.includes("/auth/login") || requestUrl.includes("/auth/refresh");
    if (error.response?.status === 401 && original && !original._retried && !skipsRefresh) {
      original._retried = true;
      try {
        const data = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${data.token}`;
        return api(original);
      } catch {
        clearAccessToken();
      }
    }
    return Promise.reject(error);
  }
);

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pendingCreateRequests() {
  try {
    return JSON.parse(sessionStorage.getItem(IDEMPOTENCY_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePendingCreateRequests(requests) {
  try {
    if (Object.keys(requests).length) {
      sessionStorage.setItem(IDEMPOTENCY_STORAGE_KEY, JSON.stringify(requests));
    } else {
      sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
    }
  } catch {
    // The backend remains compatible if browser storage is unavailable.
  }
}

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function postCreate(url, data, config = {}) {
  const fingerprint = stableSerialize({ url, data });
  const requests = pendingCreateRequests();
  const idempotencyKey = requests[fingerprint] || newIdempotencyKey();
  requests[fingerprint] = idempotencyKey;
  savePendingCreateRequests(requests);

  try {
    const response = await api.post(url, data, {
      ...config,
      headers: {
        ...(config.headers || {}),
        "Idempotency-Key": idempotencyKey,
      },
    });
    const current = pendingCreateRequests();
    if (current[fingerprint] === idempotencyKey) {
      delete current[fingerprint];
      savePendingCreateRequests(current);
    }
    return response;
  } catch (error) {
    throw error;
  }
}

export function formatApiError(err) {
  const d = err?.response?.data?.detail;
  if (!d) return tr(err?.message || tr("Erro inesperado"));
  if (typeof d === "string") return tr(d);
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  if (typeof d.message === "string") return tr(d.message);
  return String(d);
}

export const fmtMoney = (v, currency = "EUR") => {
  try {
    return new Intl.NumberFormat(getLocale(), { style: "currency", currency }).format(v || 0);
  } catch {
    return `€ ${(v || 0).toFixed(2)}`;
  }
};

export const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(getLocale());
};

export default api;
