import { useTheme } from "@/context/ThemeContext";

/**
 * Logo do Aura Finance — troca automaticamente entre versão clara/escura
 * de acordo com o tema resolvido.
 *
 * Props:
 *  - variant: "full" (símbolo + AURA FINANCE) | "mark" (só o símbolo)
 *  - className: classes Tailwind para controlar dimensão (ex: "h-10", "h-12")
 *  - alt: texto alternativo
 */
export default function Logo({ variant = "full", className = "h-10 w-auto", alt = "Aura Finance" }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  // No light mode usamos a versão "light" (símbolo + texto escuro) — fica bem em fundo claro.
  // No dark mode usamos a versão "dark" (com gradientes vivos e brancos) — fica bem em fundo escuro.
  const src = `/logo-${variant === "mark" ? "mark" : "full"}-${isDark ? "dark" : "light"}.png`;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
      data-testid={`logo-${variant}`}
    />
  );
}
