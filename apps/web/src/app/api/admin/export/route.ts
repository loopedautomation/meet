import { asc, eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { getMemberUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

/** Full instance export (owner only): members, channels, messages — your
 * data leaves with you, that's the point of owning the server. */
export async function GET() {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (user?.role !== "owner") {
    return NextResponse.json({ error: "owner required" }, { status: 403 })
  }
  const db = getDb()
  const [settings, members, channels, messages] = await Promise.all([
    db.query.instanceSettings.findFirst(),
    db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.memberships.role,
        joinedAt: schema.memberships.createdAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)),
    db.select().from(schema.channels).orderBy(asc(schema.channels.createdAt)),
    db.select().from(schema.messages).orderBy(asc(schema.messages.createdAt)),
  ])
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
