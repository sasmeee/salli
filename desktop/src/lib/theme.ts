import { getCurrentWindow } from "@tauri-apps/api/window";

export type Theme = "system" | "light" | "dark";

const KEY = "salli-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // storage blocked, still apply for this session
  }
  apply(t);
}

function apply(t: Theme) {
  const dark = t === "dark" || (t === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  // title bar follows too, null means follow windows
  getCurrentWindow()
    .setTheme(t === "system" ? null : t)
    .catch(() => {});
}

media.addEventListener("change", () => {
  if (getTheme() === "system") apply("system");
});

apply(getTheme());
