import { and, eq, getDb, schema, sql } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { canAccessChannel, getChannelByRoomName } from "@/lib/server/channels"
import { getMemberUser } from "@/lib/server/session"

type Params = { params: Promise<{ room: string; id: string }> }

const patchSchema = z.union([
  z.object({ text: z.string().min(1).max(8000) }),
  z.object({ pinned: z.boolean() }),
])

async function resolve(params: Params["params"]) {
  const { room, id } = await params
  if (authMode() === "none") return { error: 404 as const }
  const user = await getMemberUser()
  if (!user) return { error: 401 as const }
  const channel = await getChannelByRoomName(room)
  if (!channel || !(await canAccessChannel(channel, user.id))) {
    return { error: 404 as const }
  }
  const message = await getDb().query.messages.findFirst({
    where: and(
      eq(schema.messages.id, id),
      eq(schema.messages.channelId, channel.id),
    ),
  })
  if (!message || message.deletedAt) return { error: 404 as const }
  return { user, channel, message }
}

/** Edit your own message, or pin/unpin (admins and the owner). */
export async function PATCH(request: Request, { params }: Params) {
  const ctx = await resolve(params)
  if ("error" in ctx)
    return NextResponse.json({ error: "not found" }, { status: ctx.error })
  const body = patchSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "invalid patch" }, { status: 400 })

  if ("text" in body.data) {
    if (ctx.message.authorUserId !== ctx.user.id) {
      return NextResponse.json(
        { error: "only the author edits" },
        { status: 403 },
      )
    }
    await getDb()
      .update(schema.messages)
      .set({ content: body.data.text, editedAt: sql`now()` })
      .where(eq(schema.messages.id, ctx.message.id))
    return NextResponse.json({ ok: true })
  }

  if (ctx.user.role === "member") {
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  }
  await getDb()
    .update(schema.messages)
    .set({ pinnedAt: body.data.pinned ? sql`now()` : null })
    .where(eq(schema.messages.id, ctx.message.id))
  return NextResponse.json({ ok: true })
}

/** Delete your own message; admins and the owner can delete anyone's. */
export async function DELETE(_request: Request, { params }: Params) {
  const ctx = await resolve(params)
  if ("error" in ctx)
    return NextResponse.json({ error: "not found" }, { status: ctx.error })
  const own = ctx.message.authorUserId === ctx.user.id
  if (!own && ctx.user.role === "member") {
    return NextResponse.json({ error: "not yours to delete" }, { status: 403 })
  }
  await getDb()
    .update(schema.messages)
    .set({ deletedAt: sql`now()` })
    .where(eq(schema.messages.id, ctx.message.id))
  return NextResponse.json({ ok: true })
}
