import { useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";

// Dark theme card surface (--surface in index.css).
const DARK_SURFACE = "#071A3C";
// WCAG 1.4.11: graphical objects need 3:1 against their background.
const MIN_CONTRAST = 3;

function parseHex(value) {
  const hex = String(value || "").trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

function luminance([r, g, b]) {
  const [R, G, B] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Blends a colour towards white just enough to stay visible on the dark
// surface. Colours that already contrast are returned untouched, so the hue
// the user picked is kept whenever possible.
export function readableOnDark(color) {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const surface = parseHex(DARK_SURFACE);
  if (contrastRatio(rgb, surface) >= MIN_CONTRAST) return color;
  for (let step = 1; step <= 20; step += 1) {
    const t = step / 20;
    const mixed = rgb.map((c) => c + (255 - c) * t);
    if (contrastRatio(mixed, surface) >= MIN_CONTRAST) return toHex(mixed);
  }
  return "#FFFFFF";
}

// Returns a function that adapts user-chosen colours (categories, goals) to
// the active theme.
export function useThemedColor() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return useCallback((color) => (dark ? readableOnDark(color) : color), [dark]);
}
