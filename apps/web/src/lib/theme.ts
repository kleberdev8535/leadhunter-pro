import { useCallback, useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const listeners = new Set<() => void>();

const read = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "light" as Theme,
  );
  const toggle = useCallback(() => {
    const next: Theme = read() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("lh-theme", next);
    } catch {
      /* modo privado: segue sem persistir */
    }
    listeners.forEach((l) => l());
  }, []);
  return { theme, toggle };
}
