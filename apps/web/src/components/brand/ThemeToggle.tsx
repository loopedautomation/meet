"use client"

import { useStore } from "@nanostores/react"
import { Moon, Sun } from "lucide-react"
import { useEffect } from "react"
import { $theme, initTheme, toggleTheme } from "@/stores/theme"

export function ThemeToggle() {
  const theme = useStore($theme)

  useEffect(() => {
    initTheme()
  }, [])

  return (
    <button
      type="button"
      className="btn btn-ghost btn-circle"
      onClick={toggleTheme}
      aria-label="Toggle theme"
    >
      {theme === "looped-dark" ? (
        <Sun className="size-5" />
      ) : (
        <Moon className="size-5" />
      )}
    </button>
  )
}
