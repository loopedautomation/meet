"use client"

import type { MouseEvent, ReactNode } from "react"

declare global {
  interface Window {
    loopedMeetDesktop?: {
      signOut: () => Promise<unknown>
    }
  }
}

export function SignOutLink({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const signOut = async (event: MouseEvent<HTMLAnchorElement>) => {
    const desktopBridge = window.loopedMeetDesktop
    const inElectron = navigator.userAgent.includes("Electron")
    if (!desktopBridge && !inElectron) return
    event.preventDefault()

    if (desktopBridge) {
      await desktopBridge.signOut().catch(() => {})
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3000)
    await fetch("/api/desktop/logout", {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
    }).catch(() => {})
    window.clearTimeout(timeout)
    window.location.assign("/auth/logout")
  }

  return (
    <a href="/auth/logout" className={className} onClick={signOut}>
      {children}
    </a>
  )
}
