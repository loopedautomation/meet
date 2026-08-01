import { and, eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { getChannelByRoomName } from "@/lib/server/channels"
import { getMemberUser } from "@/lib/server/session"

type Params = { params: Promise<{ room: string }> }

const agentIdSchema = z.object({ agentId: z.string().regex(/^[a-z0-9-]+$/) })

/** Agents assigned to this channel (members can see; admins manage). */
export async function GET(_request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const { room } = await params
  const channel = await getChannelByRoomName(room)
  if (!channel)
    return NextResponse.json({ error: "channel not found" }, { status: 404 })
  const rows = await getDb()
    .select({ agentId: schema.channelAgents.agentId })
    .from(schema.channelAgents)
    .where(eq(schema.channelAgents.channelId, channel.id))
  return NextResponse.json({ agents: rows.map((r) => r.agentId) })
}

/** Assign an agent to the channel — it becomes a member: dispatched when
 * the first human joins, parked when the channel empties. Admin+. */
export async function POST(request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  if (user.role === "member") {
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  }
  const { room } = await params
  const channel = await getChannelByRoomName(room)
  if (!channel)
    return NextResponse.json({ error: "channel not found" }, { status: 404 })
  const body = agentIdSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "agentId required" }, { status: 400 })
  await getDb()
    .insert(schema.channelAgents)
    .values({
      channelId: channel.id,
      agentId: body.data.agentId,
      addedBy: user.id,
    })
    .onConflictDoNothing()
  return NextResponse.json({ ok: true })
}

/** Unassign. Admin+. */
export async function DELETE(request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  if (user.role === "member") {
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  }
  const { room } = await params
  const channel = await getChannelByRoomName(room)
  if (!channel)
    return NextResponse.json({ error: "channel not found" }, { status: 404 })
  const body = agentIdSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "agentId required" }, { status: 400 })
  await getDb()
    .delete(schema.channelAgents)
    .where(
      and(
        eq(schema.channelAgents.channelId, channel.id),
        eq(schema.channelAgents.agentId, body.data.agentId),
      ),
    )
  return NextResponse.json({ ok: true })
}
