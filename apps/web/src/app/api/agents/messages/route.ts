import { and, eq, getDb, schema, sql, uuidv7 } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { sha256Hex } from "@/lib/server/externalAgents"
import { rateLimited } from "@/lib/server/rateLimit"

export const dynamic = "force-dynamic"

// Outbound messages from a registered external agent: the agent posts
// proactively (not just replying to a turn) into channels it belongs to.
// Auth is its registration token; authorization is a channel_agents row for
// the target channel — which is also how agent DM membership is represented
// (findOrCreateAgentDm attaches the agent via channel_agents), so DMs are
// covered by the same check.

const sendSchema = z.object({
  // The channel's publicId (the ch-<publicId> room's suffix).
  channel: z.string().regex(/^[a-z0-9]{1,32}$/),
  text: z.string().min(1).max(8000),
})

export async function POST(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const auth = request.headers.get("authorization")
  const presented = auth?.match(/^Bearer (lreg_[0-9a-f]{32})$/)?.[1]
  if (!presented)
    return NextResponse.json({ error: "invalid token" }, { status: 401 })
  const db = getDb()
  const tokenRow = await db.query.agentRegistrationTokens.findFirst({
    where: eq(schema.agentRegistrationTokens.tokenHash, sha256Hex(presented)),
  })
  if (!tokenRow || tokenRow.revokedAt) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 })
  }
  const agent = await db.query.externalAgents.findFirst({
    where: eq(schema.externalAgents.registrationTokenId, tokenRow.id),
  })
  if (!agent) {
    return NextResponse.json(
      { error: "token has no registered agent" },
      { status: 401 },
    )
  }
  const body = sendSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json(
      { error: "channel and text required" },
      { status: 400 },
    )
  if (
    rateLimited(`agent-msg:${agent.id}:${body.data.channel}`, 30, 60 * 1000)
  ) {
    return NextResponse.json({ error: "slow down" }, { status: 429 })
  }
  const channel = await db.query.channels.findFirst({
    where: eq(schema.channels.publicId, body.data.channel),
  })
  if (!channel || channel.archivedAt) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 })
  }
  // The agent may only post where it's been added (channel_agents covers
  // shared channels and agent DMs alike).
  const membership = await db.query.channelAgents.findFirst({
    where: and(
      eq(schema.channelAgents.channelId, channel.id),
      eq(schema.channelAgents.agentId, agent.id),
    ),
  })
  if (!membership) {
    return NextResponse.json(
      { error: "agent is not in this channel" },
      { status: 403 },
    )
  }
  // Persisted exactly like a turn reply (agentChat.ts): the poll surfaces it.
  const id = uuidv7()
  await db.insert(schema.messages).values({
    id,
    channelId: channel.id,
    authorKind: "agent",
    authorAgentId: agent.id,
    content: body.data.text,
  })
  await db
    .update(schema.externalAgents)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(schema.externalAgents.id, agent.id))
  return NextResponse.json({ ok: true, id })
}
