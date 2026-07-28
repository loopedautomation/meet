import type { Metadata } from "next"
import { connection } from "next/server"
import type { ReactNode } from "react"
import { TelemetryProvider } from "@/components/TelemetryProvider"
import { ToastContainer } from "@/components/ui/Toast"
import { instanceId, telemetryEnabled } from "@/lib/server/telemetry"
import "@/styles/globals.css"

export const metadata: Metadata = {
  title: "Looped Meet",
  description:
    "Open-source meeting rooms with first-class AI agent participants",
}

const themeInit = `
try {
  const stored = localStorage.getItem("theme")
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches
  document.documentElement.dataset.theme =
    stored ?? (dark ? "looped-dark" : "looped-light")
} catch {}
`

export default async function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  // Render per request, not at image build: TELEMETRY_DISABLED and the
  // instance secret are the self-hoster's runtime env, not ours.
  await connection()
  return (
    <html lang="en" data-theme="looped-light" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-dvh bg-base-100 text-base-content antialiased">
        <TelemetryProvider
          enabled={telemetryEnabled()}
          instanceId={instanceId()}
        >
          {children}
        </TelemetryProvider>
        <ToastContainer />
      </body>
    </html>
  )
}
