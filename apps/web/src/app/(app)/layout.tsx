import { notFound } from "next/navigation"
import { DesktopDragStrip } from "@/components/desktop/DesktopDragStrip"
import { AppShell } from "@/components/shell/AppShell"
import { CreateServerOnboarding } from "@/components/shell/CreateServerOnboarding"
import { authMode } from "@/lib/server/authMode"
import { getServerById, listServersForUser } from "@/lib/server/servers"
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
  if (!user) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        {dragStrip}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    )
  }

  const servers = await listServersForUser(user.id)
  // Signed in, but belongs to no server yet: the create-server onboarding
  // takes the whole shell — there's no sidebar to show without a server.
  if (servers.length === 0) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        {dragStrip}
        <CreateServerOnboarding />
      </div>
    )
  }

  if (!user.role || !user.serverId) {
    // Cookie/first-membership resolution failed even though servers exist —
    // shouldn't happen, but fall back to the bare shell rather than crash.
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        {dragStrip}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    )
  }

  const activeServer =
    servers.find((s) => s.id === user.serverId) ??
    (await getServerById(user.serverId))

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
        serverName={activeServer?.name ?? "looped meet"}
        servers={servers.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          iconUrl: s.iconUrl,
          role: s.role,
        }))}
        activeServerId={user.serverId}
      >
        {children}
      </AppShell>
    </div>
  )
}
