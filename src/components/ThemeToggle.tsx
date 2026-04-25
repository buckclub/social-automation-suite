import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "dark" | "light";
const LS_KEY = "ui-theme";

/**
 * Theme toggle — flips between dark (the historical default) and a
 * light theme defined as a `.light` class override in src/index.css.
 *
 * Persists the choice to localStorage and applies the class to <html>
 * BEFORE first paint via the small inline script in index.html (added
 * separately) so there's no white-flash on page load. The component
 * itself only needs to keep state in sync with the class.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document !== "undefined" && document.documentElement.classList.contains("light")) {
      return "light";
    }
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") root.classList.add("light");
    else root.classList.remove("light");
    try { localStorage.setItem(LS_KEY, theme); } catch {}
  }, [theme]);

  const flip = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <button
      onClick={flip}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className={cn(
        "h-7 w-7 inline-flex items-center justify-center rounded-md border border-border bg-secondary/60 hover:bg-secondary transition-colors",
      )}
    >
      {theme === "dark"
        ? <Moon className="h-3.5 w-3.5 text-muted-foreground" />
        : <Sun className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}
