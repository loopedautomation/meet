import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import {
  DESKTOP_SESSION_COOKIE,
  revokeDesktopSession,
} from "@/lib/server/desktopSession"

/** Desktop shell logout: revoke the session row and drop the cookie. */
export async function POST() {
  if (authMode() !== "auth0")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const token = (await cookies()).get(DESKTOP_SESSION_COOKIE)?.value
  if (token) await revokeDesktopSession(token)
  const response = NextResponse.json({ ok: true })
  response.cookies.delete(DESKTOP_SESSION_COOKIE)
  return response
}
