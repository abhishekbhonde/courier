import { create } from "zustand";
import { storage } from "./storage";

export type Theme = "dark" | "light";

const KEY = "courier.theme";

function initial(): Theme {
  const saved = storage.get(KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function apply(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
}

export const useTheme = create<{ theme: Theme; toggle: () => void }>((set, get) => {
  const theme = initial();
  apply(theme);
  return {
    theme,
    toggle: () => {
      const next = get().theme === "dark" ? "light" : "dark";
      storage.set(KEY, next);
      apply(next);
      set({ theme: next });
    },
  };
});
