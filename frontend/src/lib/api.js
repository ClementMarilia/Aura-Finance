import axios from "axios";
import { getLocale, translate as tr } from "@/i18n";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API });

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
