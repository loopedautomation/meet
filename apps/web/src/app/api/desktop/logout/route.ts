import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import {
  DESKTOP_SESSION_COOKIE,
  revokeDesktopSession,
} from "@/lib/server/desktopSession"

/** Desktop shell logout: revoke the session row and drop the cookie. */
async function logout(request: Request) {
  if (authMode() !== "auth0")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const token = (await cookies()).get(DESKTOP_SESSION_COOKIE)?.value
  if (token) await revokeDesktopSession(token)
  const origin = process.env.APP_BASE_URL ?? new URL(request.url).origin
  const response = NextResponse.json({ ok: true })
  response.cookies.set(DESKTOP_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
    secure: origin.startsWith("https:"),
  })
  return response
}

export async function POST(request: Request) {
  return logout(request)
}

export async function DELETE(request: Request) {
  return logout(request)
}
