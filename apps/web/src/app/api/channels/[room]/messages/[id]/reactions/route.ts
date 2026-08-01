import { and, eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { canAccessChannel, getChannelByRoomName } from "@/lib/server/channels"
import { getMemberUser } from "@/lib/server/session"

type Params = { params: Promise<{ room: string; id: string }> }

// A handful of emoji, not free text — keeps the row bounded and the UI sane.
const reactSchema = z.object({ emoji: z.string().min(1).max(16) })

/** Toggle your reaction: react if you haven't, retract if you have. */
export async function POST(request: Request, { params }: Params) {
  const { room, id } = await params
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const channel = await getChannelByRoomName(room)
  if (!channel || !(await canAccessChannel(channel, user.id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const body = reactSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "emoji required" }, { status: 400 })
  const db = getDb()
  const message = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.id, id),
      eq(schema.messages.channelId, channel.id),
    ),
  })
  if (!message || message.deletedAt) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const where = and(
    eq(schema.messageReactions.messageId, id),
    eq(schema.messageReactions.userId, user.id),
    eq(schema.messageReactions.emoji, body.data.emoji),
  )
  const existing = await db.query.messageReactions.findFirst({ where })
  if (existing) {
    await db.delete(schema.messageReactions).where(where)
    return NextResponse.json({ ok: true, reacted: false })
  }
  await db
    .insert(schema.messageReactions)
    .values({ messageId: id, userId: user.id, emoji: body.data.emoji })
    .onConflictDoNothing()
  return NextResponse.json({ ok: true, reacted: true })
}
