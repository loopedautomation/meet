import { and, asc, eq, getDb, inArray, isNull, schema, uuidv7 } from "@meet/db"
import { after, NextResponse } from "next/server"
import { z } from "zod"
import { respondAsAgents } from "@/lib/server/agentChat"
import { authMode } from "@/lib/server/authMode"
import { canAccessChannel, getChannelByRoomName } from "@/lib/server/channels"
import { extractFirstUrl, fetchLinkPreview } from "@/lib/server/linkPreview"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getMemberUser } from "@/lib/server/session"

type Params = { params: Promise<{ room: string }> }

const attachmentSchema = z.object({
  key: z.string().max(300),
  name: z.string().max(160),
  type: z.string().max(120),
  size: z.number().int().positive(),
})

const sendSchema = z.object({
  text: z.string().max(8000),
  replyToId: z.string().uuid().optional(),
  attachments: z.array(attachmentSchema).max(5).optional(),
})

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
  const db = getDb()
  const rows = await db
    .select({
      id: schema.messages.id,
      authorUserId: schema.messages.authorUserId,
      authorAgentId: schema.messages.authorAgentId,
      content: schema.messages.content,
      replyToId: schema.messages.replyToId,
      attachments: schema.messages.attachments,
      linkPreview: schema.messages.linkPreview,
      pinnedAt: schema.messages.pinnedAt,
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
  const reactionRows = rows.length
    ? await db
        .select()
        .from(schema.messageReactions)
        .where(
          inArray(
            schema.messageReactions.messageId,
            rows.map((r) => r.id),
          ),
        )
    : []
  // emoji → count per message, plus which the viewer set.
  const reactionsFor = new Map<
    string,
    Record<string, { count: number; mine: boolean }>
  >()
  for (const r of reactionRows) {
    const byEmoji = reactionsFor.get(r.messageId) ?? {}
    const entry = byEmoji[r.emoji] ?? { count: 0, mine: false }
    entry.count += 1
    if (r.userId === user.id) entry.mine = true
    byEmoji[r.emoji] = entry
    reactionsFor.set(r.messageId, byEmoji)
  }
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
      ...(r.replyToId ? { replyToId: r.replyToId } : {}),
      ...(r.attachments ? { attachments: r.attachments } : {}),
      ...(r.linkPreview ? { linkPreview: r.linkPreview } : {}),
      ...(r.pinnedAt ? { pinned: true } : {}),
      reactions: reactionsFor.get(r.id) ?? {},
      own: r.authorUserId === user.id,
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
  const attachments = body.data.attachments ?? []
  if (!body.data.text.trim() && attachments.length === 0) {
    return NextResponse.json({ error: "text required" }, { status: 400 })
  }
  // An attachment key must live in this channel's namespace — uploads are
  // channel-scoped, so a key can't be replayed into another conversation.
  if (attachments.some((a) => !a.key.startsWith(`att/${channel.publicId}/`))) {
    return NextResponse.json({ error: "invalid attachment" }, { status: 400 })
  }
  const id = uuidv7()
  await getDb()
    .insert(schema.messages)
    .values({
      id,
      channelId: channel.id,
      authorUserId: user.id,
      authorKind: "user",
      content: body.data.text,
      replyToId: body.data.replyToId ?? null,
      attachments: attachments.length ? attachments : null,
    })
  // Agents that belong to this channel get their turn (DMs always;
  // shared channels on @mention). Never blocks the send.
  void respondAsAgents(
    channel,
    body.data.text,
    user.name ?? user.email ?? "someone",
  )
  // OG metadata for the message's first link, if any — fetched after the
  // fact so a slow/unreachable link never delays the send; the client
  // picks up the result on its next poll. Never blocks, never surfaces an
  // error to the sender. Scheduled with `after()` rather than a bare
  // unawaited promise: Next.js can tear down a route handler's request
  // context (including its patched fetch) once the response is sent, and
  // `after()` is the supported way to keep doing work past that point.
  const previewUrl = extractFirstUrl(body.data.text)
  if (previewUrl) {
    after(async () => {
      const preview = await fetchLinkPreview(previewUrl)
      if (!preview) return
      await getDb()
        .update(schema.messages)
        .set({ linkPreview: preview })
        .where(eq(schema.messages.id, id))
    })
  }
  return NextResponse.json({ ok: true, id })
}
