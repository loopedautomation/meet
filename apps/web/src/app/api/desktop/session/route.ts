import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import {
  DESKTOP_SESSION_COOKIE,
  redeemAuthCode,
} from "@/lib/server/desktopSession"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"

const exchangeSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  deviceName: z.string().max(120).optional(),
})

const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60

/** Desktop shell: exchange the one-time code (from the looped-meet:// deep
 * link or pasted by hand) plus the locally-held verifier for the desktop
 * session cookie. The verifier check is the phishing/CSRF defense — a
 * browser that saw the code never saw the verifier. */
export async function POST(request: Request) {
  if (authMode() !== "auth0")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  if (rateLimited(`desktop-exchange:${clientKey(request)}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 })
  }
  const body = exchangeSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json(
      { error: "code and verifier required" },
      { status: 400 },
    )
  }
  const result = await redeemAuthCode(
    body.data.code,
    body.data.verifier,
    body.data.deviceName ?? null,
  )
  if (!result.ok) {
    return NextResponse.json(
      { error: "code invalid, expired, or already used" },
      { status: 401 },
    )
  }
  const origin = process.env.APP_BASE_URL ?? new URL(request.url).origin
  const response = NextResponse.json({ ok: true })
  response.cookies.set(DESKTOP_SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
    secure: origin.startsWith("https:"),
  })
  return response
}
