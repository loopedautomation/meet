import { desc, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { createInvite } from "@/lib/server/invites"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getSessionUser } from "@/lib/server/session"

const createInviteSchema = z.object({
  role: z.enum(["admin", "member"]).default("member"),
  expiresInHours: z
    .number()
    .int()
    .positive()
    .max(24 * 90)
    .optional(),
  maxUses: z.number().int().positive().max(1000).optional(),
})

/** List invites — admins and the owner only. */
export async function GET() {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser()
  if (!user?.role || user.role === "member") {
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  }
  const invites = await getDb()
    .select()
    .from(schema.invites)
    .orderBy(desc(schema.invites.createdAt))
    .limit(200)
  return NextResponse.json({ invites })
}

/** Mint an invite link. Admins invite members; only the owner mints admin
 * invites. There is deliberately no "add member" — an invite is extended,
 * and membership exists when the person accepts it themselves. */
export async function POST(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser()
  if (!user?.role || user.role === "member") {
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  }
  if (rateLimited(`invite-create:${clientKey(request)}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "too many invites, slow down" },
      { status: 429 },
    )
  }
  const body = createInviteSchema.safeParse(
    await request.json().catch(() => ({})),
  )
  if (!body.success) {
    return NextResponse.json(
      { error: "invalid invite options" },
      { status: 400 },
    )
  }
  if (body.data.role === "admin" && user.role !== "owner") {
    return NextResponse.json(
      { error: "only the owner can mint admin invites" },
      { status: 403 },
    )
  }
  const invite = await createInvite({ createdBy: user.id, ...body.data })
  const origin = process.env.APP_BASE_URL ?? new URL(request.url).origin
  return NextResponse.json({
    code: invite.code,
    role: invite.role,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    url: `${origin}/join/${invite.code}`,
  })
}
