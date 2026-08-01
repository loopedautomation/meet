import { eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { getMemberUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

const patchSchema = z.object({
  name: z.string().max(80).nullable().optional(),
  registration: z.enum(["invite", "open"]).optional(),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
})

async function requireAdmin() {
  if (authMode() === "none") return null
  const user = await getMemberUser()
  if (!user || user.role === "member") return null
  return user
}

export async function GET() {
  const user = await requireAdmin()
  if (!user)
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  const settings = await getDb().query.instanceSettings.findFirst()
  return NextResponse.json({
    name: settings?.name ?? null,
    registration: settings?.registration ?? "invite",
    retentionDays: settings?.retentionDays ?? null,
  })
}

/** Instance settings. `registration: open` is the public-server mode —
 * anyone who signs in may join, membership still created only by their own
 * sign-in. Owner only: these change who can get in and what's kept. */
export async function PATCH(request: Request) {
  const user = await requireAdmin()
  if (!user)
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  if (user.role !== "owner") {
    return NextResponse.json({ error: "owner required" }, { status: 403 })
  }
  const body = patchSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "invalid settings" }, { status: 400 })
  const db = getDb()
  await db
    .insert(schema.instanceSettings)
    .values({ id: 1, ...body.data })
    .onConflictDoUpdate({ target: schema.instanceSettings.id, set: body.data })
  const settings = await db.query.instanceSettings.findFirst({
    where: eq(schema.instanceSettings.id, 1),
  })
  return NextResponse.json({
    name: settings?.name ?? null,
    registration: settings?.registration ?? "invite",
    retentionDays: settings?.retentionDays ?? null,
  })
}
