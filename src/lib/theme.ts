const STORAGE = "100pua-theme";

export type Theme = "light" | "dark";

export function readThemePreference(): Theme {
  if (typeof document === "undefined") return "dark";
  try {
    const stored = localStorage.getItem(STORAGE);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    //
  }
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.getElementById("theme-color-meta");
  if (meta) {
    meta.setAttribute("content", theme === "light" ? "#fafafa" : "#050505");
  }
}

export function toggleTheme(): Theme {
  const cur = readThemePreference();
  const next: Theme = cur === "light" ? "dark" : "light";
  applyTheme(next);
  try {
    localStorage.setItem(STORAGE, next);
  } catch {
    //
  }
  return next;
}
