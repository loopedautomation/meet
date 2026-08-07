import { asc, eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { onlineUserIds } from "@/lib/server/onlineRegistry"
import { getMemberUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

/** The member directory — DM picker and admin console both read this. */
export async function GET() {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user || !user.serverId)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const rows = await getDb()
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      image: schema.users.image,
      statusText: schema.users.statusText,
      presence: schema.users.presence,
      role: schema.memberships.role,
      joinedAt: schema.memberships.createdAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.serverId, user.serverId))
    .orderBy(asc(schema.memberships.createdAt))
  const online = onlineUserIds()
  return NextResponse.json({
    members: rows.map((m) => ({ ...m, online: online.has(m.id) })),
  })
}
