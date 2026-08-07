import { getDb } from "@meet/db"
import { notFound } from "next/navigation"
import { DesktopDragStrip } from "@/components/desktop/DesktopDragStrip"
import { AppShell } from "@/components/shell/AppShell"
import { authMode } from "@/lib/server/authMode"
import { getSessionUser } from "@/lib/server/session"

/**
 * The app shell: a persistent sidebar (channels, DMs, presence, user
 * footer) around every workspace route. Members get the shell; everyone
 * else gets the bare page — the pages keep their own guards, so the
 * login round-trip to /c/[slug] still has somewhere to return to.
 * In MEET_AUTH_MODE=none there is no workspace at all.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (authMode() === "none") notFound()
  const dragStrip = <DesktopDragStrip />

  const user = await getSessionUser()
  // Room/pane components size to their parent, so the bare branch still
  // provides a viewport-height container.
  if (!user?.role) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        {dragStrip}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    )
  }

  const settings = await getDb().query.instanceSettings.findFirst()
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {dragStrip}
      <AppShell
        user={{
          name: user.name,
          email: user.email,
          image: user.image,
          presence: (user.presence as "active" | "away" | "dnd") ?? "active",
          role: user.role,
        }}
        serverName={settings?.name ?? "looped meet"}
      >
        {children}
      </AppShell>
    </div>
  )
}
