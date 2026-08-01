import { and, asc, eq, getDb, isNull, schema, uuidv7 } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { canAccessChannel, getChannelByRoomName } from "@/lib/server/channels"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getMemberUser } from "@/lib/server/session"

type Params = { params: Promise<{ room: string }> }

const sendSchema = z.object({ text: z.string().min(1).max(8000) })

// The channel's text sidecar, v1: append-only history so the chat survives
// the room emptying. Live delivery stays on the LiveKit data channel;
// edit/delete persistence and pagination-by-cursor arrive with Phase 2's
// full message model.

/** Last 100 messages, oldest first — shaped like the data-channel
 * ChatMessage so the client hydrates its store directly. */
export async function GET(_request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const { room } = await params
  const channel = await getChannelByRoomName(room)
  if (!channel || !(await canAccessChannel(channel, user.id))) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 })
  }
  const rows = await getDb()
    .select({
      id: schema.messages.id,
      authorUserId: schema.messages.authorUserId,
      authorAgentId: schema.messages.authorAgentId,
      content: schema.messages.content,
      createdAt: schema.messages.createdAt,
      editedAt: schema.messages.editedAt,
      authorName: schema.users.name,
    })
    .from(schema.messages)
    .leftJoin(schema.users, eq(schema.users.id, schema.messages.authorUserId))
    .where(
      and(
        eq(schema.messages.channelId, channel.id),
        isNull(schema.messages.deletedAt),
      ),
    )
    .orderBy(asc(schema.messages.createdAt))
    .limit(100)
  return NextResponse.json({
    messages: rows.map((r) => ({
      id: r.id,
      from: r.authorUserId
        ? `u_${r.authorUserId}`
        : (r.authorAgentId ?? "unknown"),
      fromName: r.authorName ?? r.authorAgentId ?? "someone",
      text: r.content,
      at: r.createdAt.getTime(),
      ...(r.editedAt ? { editedAt: r.editedAt.getTime() } : {}),
    })),
  })
}

/** Persist a message the sender already broadcast on the data channel. */
export async function POST(request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const { room } = await params
  const channel = await getChannelByRoomName(room)
  if (!channel || !(await canAccessChannel(channel, user.id))) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 })
  }
  if (rateLimited(`channel-msg:${clientKey(request)}`, 120, 60 * 1000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 })
  }
  const body = sendSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "text required" }, { status: 400 })
  const id = uuidv7()
  await getDb().insert(schema.messages).values({
    id,
    channelId: channel.id,
    authorUserId: user.id,
    authorKind: "user",
    content: body.data.text,
  })
  return NextResponse.json({ ok: true, id })
}
