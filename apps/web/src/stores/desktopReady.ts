import { atom } from "nanostores"

declare global {
  interface Window {
    meetDesktop?: { ready?: () => void }
  }
}

/** Whether this Electron shell's minimum-viable startup state (the
 * sidebar's first channel list load) is ready. Doubles as the idempotency
 * guard for markDesktopReady — no separate flag needed. */
export const $desktopReady = atom(false)

/** Marks startup ready and, inside the Electron shell, tells it once so it
 * can swap from its loading splash to the real window (see
 * apps/desktop/src/workspace-preload.js). A no-op outside Electron —
 * window.meetDesktop only exists there — and a no-op on repeat calls. */
export function markDesktopReady() {
  if ($desktopReady.get()) return
  $desktopReady.set(true)
  if (typeof window !== "undefined") window.meetDesktop?.ready?.()
}
