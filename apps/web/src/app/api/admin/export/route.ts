import { asc, eq, getDb, inArray, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { getMemberUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

/** Full server export (owner only): members, channels, messages — your
 * data leaves with you, that's the point of owning the server. */
export async function GET() {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (user?.role !== "owner" || !user.serverId) {
    return NextResponse.json({ error: "owner required" }, { status: 403 })
  }
  const serverId = user.serverId
  const db = getDb()
  const [settings, members, channels] = await Promise.all([
    db.query.servers.findFirst({ where: eq(schema.servers.id, serverId) }),
    db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.memberships.role,
        joinedAt: schema.memberships.createdAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.serverId, serverId)),
    db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.serverId, serverId))
      .orderBy(asc(schema.channels.createdAt)),
  ])
  const channelIds = channels.map((c) => c.id)
  const messages = channelIds.length
    ? await db
        .select()
        .from(schema.messages)
        .where(inArray(schema.messages.channelId, channelIds))
        .orderBy(asc(schema.messages.createdAt))
    : []
  return new NextResponse(
    JSON.stringify({
      exportedAt: new Date().toISOString(),
      settings,
      members,
      channels,
      messages,
    }),
    {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="meet-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    },
  )
}
