import { getDb } from "@meet/db"
import { notFound } from "next/navigation"
import { AppSidebar } from "@/components/shell/AppSidebar"
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
  const user = await getSessionUser()
  // Room/pane components size to their parent, so the bare branch still
  // provides a viewport-height container.
  if (!user?.role)
    return <div className="h-dvh overflow-hidden">{children}</div>

  const settings = await getDb().query.instanceSettings.findFirst()
  return (
    <div className="flex h-dvh overflow-hidden">
      <AppSidebar
        user={{
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
        }}
        serverName={settings?.name ?? "looped meet"}
      />
      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
