import axios from "axios";
import { getLocale, translate as tr } from "@/i18n";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API });
const IDEMPOTENCY_STORAGE_KEY = "crelith.pending-create-requests";

export const CURRENCIES = [
  { value: "EUR", label: "EUR (€)" },
  { value: "BRL", label: "BRL (R$)" },
  { value: "USD", label: "USD ($)" },
  { value: "CHF", label: "CHF (Fr)" },
];

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

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
