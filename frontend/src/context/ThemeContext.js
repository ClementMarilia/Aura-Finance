import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

/**
 * ThemeProvider — gerencia o tema do app.
 * 3 opções: "light", "dark", "system" (segue o SO).
 * Persiste em localStorage ("aurea_theme").
 */
const ThemeContext = createContext({
  theme: "system",
  setTheme: () => {},
  resolvedTheme: "light",
});

const STORAGE_KEY = "aurea_theme";

function applyTheme(theme) {
  const html = document.documentElement;
  let effective = theme;
  if (theme === "system") {
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    effective = prefersDark ? "dark" : "light";
  }
  html.classList.toggle("dark", effective === "dark");
  // Atualiza theme-color do navegador (status bar PWA, barra do iOS)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", effective === "dark" ? "#0F1311" : "#1E3F33");
  return effective;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === "undefined") return "system";
    try { return localStorage.getItem(STORAGE_KEY) || "system"; } catch (_) { return "system"; }
  });
  const [resolvedTheme, setResolvedTheme] = useState("light");

  // Aplicar no mount e a cada mudança
  useEffect(() => {
    const effective = applyTheme(theme);
    setResolvedTheme(effective);
  }, [theme]);

  // Se "system", reagir a mudanças do SO
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const eff = applyTheme("system");
      setResolvedTheme(eff);
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t) => {
    try { localStorage.setItem(STORAGE_KEY, t); } catch (_) { /* ignore */ }
    setThemeState(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
