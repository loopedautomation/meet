"use client"

import { useEffect } from "react"

const OPEN_PREFERENCES_EVENT = "looped:open-preferences"

declare global {
  interface Window {
    __loopedOpenPreferencesRequested?: boolean
  }
}

function isPreferencesShortcut(e: KeyboardEvent) {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === ","
}

export function usePreferencesShortcut(openPreferences: () => void) {
  useEffect(() => {
    const open = () => {
      window.__loopedOpenPreferencesRequested = false
      openPreferences()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isPreferencesShortcut(e)) return
      e.preventDefault()
      open()
    }

    window.addEventListener(OPEN_PREFERENCES_EVENT, open)
    window.addEventListener("keydown", onKeyDown)
    if (window.__loopedOpenPreferencesRequested) open()
    return () => {
      window.removeEventListener(OPEN_PREFERENCES_EVENT, open)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [openPreferences])
}
