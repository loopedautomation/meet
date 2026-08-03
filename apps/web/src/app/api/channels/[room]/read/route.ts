import { getDb, schema, sql } from "@meet/db"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { canAccessChannel, getChannelByRoomName } from "@/lib/server/channels"
import { getMemberUser } from "@/lib/server/session"

type Params = { params: Promise<{ room: string }> }

/** "I'm caught up here" — stamps the unread marker. */
export async function POST(_request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const { room } = await params
  const channel = await getChannelByRoomName(room)
  if (!channel || !(await canAccessChannel(channel, user.id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  await getDb()
    .insert(schema.channelReads)
    .values({ channelId: channel.id, userId: user.id })
    .onConflictDoUpdate({
      target: [schema.channelReads.channelId, schema.channelReads.userId],
      set: { lastReadAt: sql`now()` },
    })
  return NextResponse.json({ ok: true })
}
