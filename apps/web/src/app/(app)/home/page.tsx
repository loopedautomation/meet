import { getDb, isNull, schema } from "@meet/db"
import { MessagesSquare } from "lucide-react"
import { notFound, redirect } from "next/navigation"
import { InviteButton } from "@/components/shell/InviteButton"
import { authMode } from "@/lib/server/authMode"
import { getSessionUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

/** The workspace home pane — what a member sees inside the shell before
 * picking a conversation. Doubles as the empty-server onboarding. */
export default async function WorkspaceHomePage() {
  if (authMode() === "none") notFound()
  const user = await getSessionUser()
  if (!user) redirect("/auth/login?returnTo=/home")
  if (!user.role) redirect("/")

  const anyChannel = await getDb().query.channels.findFirst({
    where: isNull(schema.channels.archivedAt),
  })
  const isAdmin = user.role !== "member"

  return (
    <section className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <MessagesSquare className="size-10 text-base-content/30" />
      {anyChannel ? (
        <>
          <h1 className="font-semibold text-2xl">
            Welcome back{user.name ? `, ${user.name.split(" ")[0]}` : ""}
          </h1>
          <p className="max-w-md text-balance text-base-content/60">
            Pick a channel or conversation from the sidebar, or start a new one.
          </p>
        </>
      ) : isAdmin ? (
        <>
          <h1 className="font-semibold text-2xl">Your server is ready</h1>
          <p className="max-w-md text-balance text-base-content/60">
            It's quiet in here. Create your first channel with the{" "}
            <span className="font-medium">+</span> button in the sidebar, and
            bring your team in.
          </p>
          <InviteButton />
        </>
      ) : (
        <>
          <h1 className="font-semibold text-2xl">Nothing here yet</h1>
          <p className="max-w-md text-balance text-base-content/60">
            No channels have been created. Ask an admin to set some up — or
            start a direct message from the sidebar.
          </p>
        </>
      )}
    </section>
  )
}
