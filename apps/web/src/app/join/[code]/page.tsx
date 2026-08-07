import { LogIn } from "lucide-react"
import { notFound } from "next/navigation"
import { Wordmark } from "@/components/brand/BrandMark"
import { DesktopDragStrip } from "@/components/desktop/DesktopDragStrip"
import { AcceptInvite } from "@/components/join/AcceptInvite"
import { authMode } from "@/lib/server/authMode"
import { checkInvite } from "@/lib/server/invites"
import { getSessionUser } from "@/lib/server/session"

type Params = { params: Promise<{ code: string }> }

const reasonCopy: Record<string, string> = {
  "not-found": "This invite link doesn't exist.",
  revoked: "This invite has been revoked.",
  expired: "This invite has expired.",
  exhausted: "This invite has already been used up.",
}

export default async function JoinPage({ params }: Params) {
  if (authMode() === "none") notFound()
  const { code } = await params
  const [invite, user] = await Promise.all([
    checkInvite(code),
    getSessionUser(),
  ])

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <DesktopDragStrip />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col overflow-y-auto px-6">
        <header className="py-6">
          <Wordmark />
        </header>
        <section className="flex flex-1 flex-col items-center justify-center gap-4 pb-24 text-center">
          {!invite.ok ? (
            <>
              <h1 className="font-semibold text-2xl">Invite not usable</h1>
              <p className="text-base-content/70">
                {reasonCopy[invite.reason]}
              </p>
              <p className="text-base-content/50 text-sm">
                Ask whoever invited you for a fresh link.
              </p>
            </>
          ) : user?.role ? (
            <>
              <h1 className="font-semibold text-2xl">
                You're already a member
              </h1>
              <a href="/" className="btn btn-primary btn-brutalist">
                Go to the workspace
              </a>
            </>
          ) : user ? (
            <>
              <h1 className="font-semibold text-2xl">Join this server</h1>
              <p className="text-base-content/70">
                You've been invited as a
                {invite.role === "admin" ? "n admin" : " member"}. Joining is
                your call — nothing happens until you accept.
              </p>
              <AcceptInvite code={code} />
            </>
          ) : (
            <>
              <h1 className="font-semibold text-2xl">You're invited</h1>
              <p className="text-base-content/70">
                Sign in first, then accept the invite.
              </p>
              <a
                href={`/auth/login?returnTo=/join/${encodeURIComponent(code)}`}
                className="btn btn-primary btn-brutalist"
              >
                <LogIn className="size-4" />
                Sign in to continue
              </a>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
