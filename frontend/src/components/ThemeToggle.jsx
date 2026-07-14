import { useTheme } from "@/context/ThemeContext";
import { Sun, Moon, Monitor } from "lucide-react";

/**
 * ThemeToggle — botão segmentado com 3 opções: Claro / Sistema / Escuro.
 * Indicado para a sidebar ou cabeçalho.
 */
export default function ThemeToggle({ variant = "segmented" }) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  if (variant === "icon") {
    // Modo cíclico (light → dark → system → light)
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
    return (
      <button
        type="button"
        onClick={() => setTheme(next)}
        data-testid="theme-toggle-icon"
        title={`Tema: ${theme === "system" ? "Sistema" : theme === "dark" ? "Escuro" : "Claro"} (clique para alternar)`}
        className="p-2 rounded-lg hover:bg-[#F1EFE7] transition"
        style={{ color: "var(--text-muted)" }}
      >
        <Icon size={18} />
      </button>
    );
  }

  const options = [
    { key: "light", label: "Claro", Icon: Sun },
    { key: "system", label: "Sistema", Icon: Monitor },
    { key: "dark", label: "Escuro", Icon: Moon },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      data-testid="theme-toggle"
      className="inline-flex rounded-xl p-1 gap-1"
      style={{ background: "var(--surface-muted)" }}
    >
      {options.map(({ key, label, Icon }) => {
        const active = theme === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(key)}
            data-testid={`theme-${key}`}
            title={`${label}${theme === "system" && key === "system" ? ` (atual: ${resolvedTheme === "dark" ? "escuro" : "claro"})` : ""}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition"
            style={{
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--primary)" : "var(--text-muted)",
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            }}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
