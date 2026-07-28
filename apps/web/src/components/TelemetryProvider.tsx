"use client"

import { usePathname } from "next/navigation"
import posthog from "posthog-js"
import { type ReactNode, useEffect, useRef } from "react"
import { markTelemetryReady } from "@/lib/analytics"

// Room slugs are meeting codes — never send them upstream.
function sanitizePath(path: string): string {
  return path.startsWith("/r/") ? "/r/[slug]" : path
}

function sanitizeUrlProp(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    const url = new URL(value, window.location.origin)
    url.pathname = sanitizePath(url.pathname)
    return url.toString()
  } catch {
    return sanitizePath(value)
  }
}

export function TelemetryProvider({
  enabled,
  instanceId,
  children,
}: {
  enabled: boolean
  instanceId: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const initialized = useRef(false)

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!enabled || !key || initialized.current) return
    initialized.current = true
    posthog.init(key, {
      api_host: "/ingest",
      ui_host: "https://us.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_toolbar_metrics: true,
      persistence: "localStorage",
      sanitize_properties: (props) => {
        for (const k of ["$current_url", "$pathname", "$referrer"]) {
          if (k in props) props[k] = sanitizeUrlProp(props[k])
        }
        return props
      },
    })
    posthog.register({ instance_id: instanceId })
    posthog.group("instance", instanceId)
    markTelemetryReady()
  }, [enabled, instanceId])

  useEffect(() => {
    if (!enabled || !initialized.current || !pathname) return
    const path = sanitizePath(pathname)
    posthog.capture("$pageview", {
      $current_url: `${window.location.origin}${path}`,
      path,
    })
  }, [enabled, pathname])

  return children
}
