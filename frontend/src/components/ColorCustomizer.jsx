import { RotateCcw } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { translate as tr } from "@/i18n";
import { COLOR_TOKENS, COLOR_PRESETS, DEFAULT_COLORS } from "@/lib/customColors";

/**
 * ColorCustomizer — permite escolher as cores do app (por modo claro/escuro),
 * com temas rápidos e botão para restaurar o padrão.
 */
export default function ColorCustomizer() {
  const { resolvedTheme, customColors, setCustomColors } = useTheme();
  const mode = resolvedTheme === "dark" ? "dark" : "light";
  const current = customColors[mode] || {};
  const defaults = DEFAULT_COLORS[mode];

  const update = (patch) =>
    setCustomColors({ ...customColors, [mode]: { ...current, ...patch } });
  const reset = () => setCustomColors({ ...customColors, [mode]: {} });
  const hasCustom = Object.keys(current).length > 0;

  return (
    <div className="mt-6 pt-5 border-t" style={{ borderColor: "var(--border)" }} data-testid="color-customizer">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h4 className="text-base font-semibold" style={{ fontFamily: "Outfit" }}>{tr("Cores personalizadas")}</h4>
        <button
          type="button"
          onClick={reset}
          disabled={!hasCustom}
          data-testid="colors-reset"
          className="inline-flex items-center gap-1.5 text-xs font-medium disabled:opacity-40"
          style={{ color: "var(--text-muted)" }}
        >
          <RotateCcw size={13} /> {tr("Restaurar padrão")}
        </button>
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        {mode === "dark"
          ? tr("Ajustando as cores do modo escuro. Alterne o tema acima para ajustar o modo claro.")
          : tr("Ajustando as cores do modo claro. Alterne o tema acima para ajustar o modo escuro.")}
      </p>

      <div className="flex flex-wrap gap-2 mb-4" data-testid="color-presets">
        {COLOR_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => update(p.colors)}
            data-testid={`color-preset-${p.key}`}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium"
            style={{ borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--text-main)" }}
          >
            <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: p.colors.primary }} />
            {tr(p.label)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {COLOR_TOKENS.map(({ key, label }) => {
          const value = current[key] || defaults[key];
          return (
            <label
              key={key}
              className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 cursor-pointer"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="text-sm">{tr(label)}</span>
              <input
                type="color"
                value={value}
                onChange={(e) => update({ [key]: e.target.value })}
                data-testid={`color-input-${key}`}
                aria-label={tr(label)}
                className="h-8 w-10 rounded cursor-pointer border-0 bg-transparent p-0"
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
