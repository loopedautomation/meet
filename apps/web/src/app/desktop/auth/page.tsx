import { LogIn } from "lucide-react"
import { notFound, redirect } from "next/navigation"
import { Wordmark } from "@/components/brand/BrandMark"
import { DesktopDragStrip } from "@/components/desktop/DesktopDragStrip"
import { authMode } from "@/lib/server/authMode"
import { approveAuthRequest } from "@/lib/server/desktopSession"
import { getSessionUser } from "@/lib/server/session"

type SearchParams = { searchParams: Promise<{ request?: string }> }

export const dynamic = "force-dynamic"

/**
 * Browser leg of the desktop sign-in handoff. The shell opened this URL in
 * the default browser (where the member is already signed in with GitHub &
 * co); once authenticated, the pending request gets its one-time code and
 * the page hands it back via the looped-meet:// deep link — or by hand, the
 * code is shown for pasting into the app. Minting is first-approval-wins,
 * so a reload can't re-key an already-issued request.
 */
export default async function DesktopAuthPage({ searchParams }: SearchParams) {
  if (authMode() !== "auth0") notFound()
  const { request } = await searchParams
  if (!request || !/^[0-9a-f-]{36}$/.test(request)) notFound()

  const user = await getSessionUser()
  if (!user) {
    redirect(`/auth/login?returnTo=/desktop/auth?request=${request}`)
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <DesktopDragStrip />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col overflow-y-auto px-6">
        <header className="py-6">
          <Wordmark />
        </header>
        <section className="flex flex-1 flex-col items-center justify-center gap-4 pb-24 text-center">
          {!user.role ? (
            <>
              <h1 className="font-semibold text-2xl">Not a member yet</h1>
              <p className="text-base-content/70">
                You're signed in, but this server is invite-only. Ask a member
                for an invite, then try again from the desktop app.
              </p>
            </>
          ) : (
            <Approved requestId={request} userId={user.id} />
          )}
        </section>
      </main>
    </div>
  )
}

async function Approved({
  requestId,
  userId,
}: {
  requestId: string
  userId: string
}) {
  const result = await approveAuthRequest(requestId, userId)
  if (!result.ok) {
    return (
      <>
        <h1 className="font-semibold text-2xl">This link has expired</h1>
        <p className="text-base-content/70">
          Sign-in links are single-use and short-lived. Start the sign-in again
          from the desktop app.
        </p>
      </>
    )
  }
  const origin = process.env.APP_BASE_URL ?? "http://localhost:3000"
  const deepLink = `looped-meet://auth?code=${result.code}&server=${encodeURIComponent(origin)}`
  return (
    <>
      <h1 className="font-semibold text-2xl">You're signed in</h1>
      <p className="text-base-content/70">
        Hand this sign-in to the desktop app to finish up.
      </p>
      <a href={deepLink} className="btn btn-primary btn-brutalist">
        <LogIn className="size-4" />
        Open looped meet
      </a>
      <p className="text-base-content/50 text-sm">
        Nothing happening? Paste this code into the app instead:
      </p>
      <code className="select-all break-all rounded bg-base-200 px-3 py-2 text-sm">
        {result.code}
      </code>
    </>
  )
}
