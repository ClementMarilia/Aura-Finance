import { useTheme } from "@/context/ThemeContext";

/**
 * Logo da Crelith Finance — troca automaticamente entre as aplicações
 * para superfícies claras e escuras.
 *
 * Props:
 *  - variant: "full" (símbolo + CRELITH FINANCE) | "mark" (só o símbolo)
 *  - className: classes Tailwind para controlar dimensão (ex: "h-10", "h-12")
 *  - alt: texto alternativo
 *  - surface: "auto" | "light" | "dark"
 */
export default function Logo({
  variant = "full",
  className = "h-10 w-auto",
  alt = "Crelith Finance",
  surface = "auto",
}) {
  const { resolvedTheme } = useTheme();
  const isDarkSurface = surface === "dark" || (surface === "auto" && resolvedTheme === "dark");
  const src = `/logo-${variant === "mark" ? "mark" : "full"}-${isDarkSurface ? "dark" : "light"}.png`;

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
