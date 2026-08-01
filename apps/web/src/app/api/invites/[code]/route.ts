import { eq, getDb, schema, sql } from "@meet/db"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { checkInvite, redeemInvite } from "@/lib/server/invites"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getSessionUser } from "@/lib/server/session"

type Params = { params: Promise<{ code: string }> }

const codeShape = /^[A-Za-z0-9_-]{8,32}$/

/** Peek at an invite's validity (the /join page's data source). Never
 * reveals who minted it or how many uses remain. */
export async function GET(request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const { code } = await params
  if (!codeShape.test(code)) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  if (rateLimited(`invite-peek:${clientKey(request)}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 })
  }
  const check = await checkInvite(code)
  return NextResponse.json(
    check.ok
      ? { valid: true, role: check.role }
      : { valid: false, reason: check.reason },
  )
}

/** Accept the invite as the signed-in user — membership is created here and
 * nowhere else (after the first-login owner bootstrap). */
export async function POST(request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const { code } = await params
  if (!codeShape.test(code)) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  if (rateLimited(`invite-accept:${clientKey(request)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 })
  }
  const user = await getSessionUser()
  if (!user)
    return NextResponse.json({ error: "sign in first" }, { status: 401 })
  if (user.role)
    return NextResponse.json({ ok: true, role: user.role, already: true })
  const result = await redeemInvite(code, user.id)
  if (!result.ok) {
    return NextResponse.json(
      { error: `invite ${result.reason}` },
      { status: 410 },
    )
  }
  return NextResponse.json({ ok: true, role: result.role })
}

/** Revoke — admins and the owner. */
export async function DELETE(_request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const { code } = await params
  const user = await getSessionUser()
  if (!user?.role || user.role === "member") {
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  }
  await getDb()
    .update(schema.invites)
    .set({ revokedAt: sql`now()` })
    .where(eq(schema.invites.code, code))
  return NextResponse.json({ ok: true })
}
