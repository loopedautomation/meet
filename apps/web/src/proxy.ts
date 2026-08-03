import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { auth0 } from "@/lib/server/auth0"
import { authMode } from "@/lib/server/authMode"

// Mounts the Auth0 SDK's /auth/* routes (login, logout, callback, …) and
// keeps session cookies rolling. In MEET_AUTH_MODE=none this is a pure
// pass-through: no cookies, no redirects, no /auth routes — the
// pre-accounts product exactly.
export async function proxy(request: NextRequest) {
  if (authMode() === "none") return NextResponse.next()
  return await auth0().middleware(request)
}

export const config = {
  matcher: [
    // Skip static assets entirely; API routes and pages resolve sessions
    // themselves via the session seam. The LiveKit webhook is server-to-
    // server (JWT-signed body, no cookies) — never route it through auth.
    "/((?!_next/static|_next/image|favicon.ico|icon.png|stt/|ingest/|api/livekit/webhook).*)",
  ],
}
