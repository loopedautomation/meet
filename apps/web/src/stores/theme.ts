import { atom } from "nanostores"

export type Theme = "looped-light" | "looped-dark"

export const $theme = atom<Theme>("looped-light")

export function initTheme() {
  if (typeof document === "undefined") return
  const current = document.documentElement.dataset.theme as Theme | undefined
  if (current) $theme.set(current)
}

export function setTheme(theme: Theme) {
  $theme.set(theme)
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem("theme", theme)
  } catch {}
}

export function toggleTheme() {
  setTheme($theme.get() === "looped-dark" ? "looped-light" : "looped-dark")
}
