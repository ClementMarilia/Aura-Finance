/**
 * Personalização de cores — o usuário escolhe cores que sobrescrevem as
 * variáveis CSS do tema. Guardado por modo (claro/escuro) em localStorage.
 */
export const COLOR_STORAGE_KEY = "aura_custom_colors";

export const COLOR_TOKENS = [
  { key: "primary", label: "Cor de destaque", vars: ["--primary", "--primary-hover"] },
  { key: "bg", label: "Fundo", vars: ["--bg"] },
  { key: "surface", label: "Cartões", vars: ["--surface", "--surface-elevated"] },
  { key: "text", label: "Texto", vars: ["--text-main"] },
  { key: "success", label: "Positivo (receitas)", vars: ["--success"] },
  { key: "danger", label: "Negativo (despesas)", vars: ["--danger"] },
];

export const DEFAULT_COLORS = {
  light: { primary: "#061B4A", bg: "#F7F5EF", surface: "#FFFFFF", text: "#061B4A", success: "#2C7A51", danger: "#D9453B" },
  dark: { primary: "#08D7A5", bg: "#04112F", surface: "#071A3C", text: "#FFFFFF", success: "#4FD49B", danger: "#F26B61" },
};

export const COLOR_PRESETS = [
  { key: "ocean", label: "Oceano", colors: { primary: "#1268F4" } },
  { key: "forest", label: "Floresta", colors: { primary: "#2C7A51" } },
  { key: "sunset", label: "Pôr do sol", colors: { primary: "#D96C5B" } },
  { key: "violet", label: "Violeta", colors: { primary: "#7C3AED" } },
  { key: "graphite", label: "Grafite", colors: { primary: "#374151" } },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isValidHex(v) {
  return typeof v === "string" && HEX_RE.test(v);
}

/** Mantém só chaves conhecidas com hex válido. */
export function sanitizeColors(raw) {
  const out = { light: {}, dark: {} };
  const keys = COLOR_TOKENS.map((t) => t.key);
  for (const mode of ["light", "dark"]) {
    for (const k of keys) {
      const v = raw?.[mode]?.[k];
      if (isValidHex(v)) out[mode][k] = v.toUpperCase();
    }
  }
  return out;
}

export function loadCustomColors() {
  try {
    return sanitizeColors(JSON.parse(localStorage.getItem(COLOR_STORAGE_KEY) || "{}"));
  } catch (_) {
    return sanitizeColors({});
  }
}

export function saveCustomColors(colors) {
  try {
    localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(sanitizeColors(colors)));
  } catch (_) { /* ignore */ }
}

/** Preto ou branco, o que tiver mais contraste sobre `hex`. */
export function contrastText(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#061B4A" : "#FFFFFF";
}

const ALL_VARS = [...COLOR_TOKENS.flatMap((t) => t.vars), "--primary-fg"];

/** Aplica (ou limpa) as cores do modo efetivo no elemento raiz. */
export function applyCustomColors(colors, mode, root = document.documentElement) {
  ALL_VARS.forEach((v) => root.style.removeProperty(v));
  const chosen = sanitizeColors(colors)[mode === "dark" ? "dark" : "light"];
  for (const token of COLOR_TOKENS) {
    const value = chosen[token.key];
    if (!value) continue;
    token.vars.forEach((v) => root.style.setProperty(v, value));
    if (token.key === "primary") root.style.setProperty("--primary-fg", contrastText(value));
  }
}
