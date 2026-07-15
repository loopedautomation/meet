import { atom } from "nanostores"

export type Theme = "looped-light" | "looped-dark"

export const $theme = atom<Theme>("looped-light")

export function initTheme() {
  if (typeof document === "undefined") return
  const current = document.documentElement.dataset.theme as Theme | undefined
  if (current) $theme.set(current)
}

export function toggleTheme() {
  const next = $theme.get() === "looped-dark" ? "looped-light" : "looped-dark"
  $theme.set(next)
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem("theme", next)
  } catch {}
}
