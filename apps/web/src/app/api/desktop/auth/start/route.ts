import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { startAuthRequest } from "@/lib/server/desktopSession"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"

// 32 random bytes base64url-encoded is 43 chars.
const startSchema = z.object({
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})

/** Desktop shell: begin a browser sign-in handoff. Unauthenticated — the
 * request is inert until a signed-in member approves it in the browser,
 * and worthless without the verifier that stays in the shell. */
export async function POST(request: Request) {
  if (authMode() !== "auth0")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  if (rateLimited(`desktop-auth-start:${clientKey(request)}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 })
  }
  const body = startSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: "challenge required" }, { status: 400 })
  }
  const authRequest = await startAuthRequest(body.data.challenge)
  return NextResponse.json({ requestId: authRequest.id })
}
