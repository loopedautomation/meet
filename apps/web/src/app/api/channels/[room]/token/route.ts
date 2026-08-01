import { eq, getDb, schema } from "@meet/db"
import type { ParticipantMeta, RoomMetadata } from "@meet/shared"
import { parseParticipantMeta, tokenRequestSchema } from "@meet/shared"
import { AccessToken } from "livekit-server-sdk"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { bridgeFetch } from "@/lib/server/bridge"
import {
  canAccessChannel,
  channelRoomName,
  getChannelByRoomName,
} from "@/lib/server/channels"
import { livekitEnv, roomService } from "@/lib/server/livekit"
import { getMemberUser } from "@/lib/server/session"
import { deriveHostKey } from "@/lib/server/slug"

type Params = { params: Promise<{ room: string }> }

/** Fire-and-forget: never blocks the join. A failed dispatch means the
 * agent misses this occupancy window; the next first-join retries. */
async function dispatchAssignedAgents(
  channelId: string,
  roomName: string,
): Promise<void> {
  try {
    const assigned = await getDb()
      .select({ agentId: schema.channelAgents.agentId })
      .from(schema.channelAgents)
      .where(eq(schema.channelAgents.channelId, channelId))
    await Promise.allSettled(
      assigned.map(({ agentId }) =>
        bridgeFetch(`/rooms/${roomName}/agents/${agentId}`, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        }),
      ),
    )
  } catch (err) {
    console.error("channel agent dispatch failed", err)
  }
}

/**
 * The channel join path. Deliberately not the meeting token route: a channel
 * never has a start gate (no 425), never a waiting room, and no hostKey
 * ritual — membership IS admission. The LiveKit room is disposable
 * (recreated here on demand, GC'd when empty via the same timeouts +
 * end-when-empty as meetings); the channel row is the durable thing.
 */
export async function POST(request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const { room } = await params
  const channel = await getChannelByRoomName(room)
  if (!channel || channel.archivedAt) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 })
  }
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  if (!(await canAccessChannel(channel, user.id))) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 })
  }

  const body = tokenRequestSchema.safeParse(await request.json())
  if (!body.success) {
    return NextResponse.json({ error: "displayName required" }, { status: 400 })
  }

  const roomName = channelRoomName(channel)
  const metadata: RoomMetadata = {
    kind: "channel",
    channelId: channel.id,
    started: true,
    startedAt: Date.now(),
  }

  // Recreate-on-join: the isRecreatableRoomSlug pattern, gated on the DB row
  // instead of a slug shape.
  let existing = await roomService()
    .listRooms([roomName])
    .catch(() => [])
  if (existing.length === 0) {
    const created = await roomService()
      .createRoom({
        name: roomName,
        emptyTimeout: 300,
        departureTimeout: 60,
        metadata: JSON.stringify(metadata),
      })
      .catch(() => null)
    if (!created) {
      return NextResponse.json(
        { error: "room state unavailable, try again" },
        { status: 503 },
      )
    }
    existing = [created]
  }

  let roomMeta: RoomMetadata = metadata
  try {
    roomMeta = { ...metadata, ...JSON.parse(existing[0].metadata || "{}") }
  } catch {}

  // Occupancy — fails closed like the meeting route.
  let participantCount: number
  try {
    const present = await roomService().listParticipants(roomName)
    participantCount = present.filter(
      (p) => parseParticipantMeta(p.metadata)?.kind === "human",
    ).length
  } catch {
    return NextResponse.json(
      { error: "room state unavailable, try again" },
      { status: 503 },
    )
  }

  // First human in re-anchors the channel's call timer, matching meeting
  // semantics — a channel occupied all day keeps one clock; an empty channel
  // joined fresh starts from 0:00. It also wakes the channel's assigned
  // agents: they're members, present whenever anyone is, parked when the
  // empty room is torn down.
  if (participantCount === 0) {
    roomMeta = { ...roomMeta, startedAt: Date.now() }
    await roomService()
      .updateRoomMetadata(roomName, JSON.stringify(roomMeta))
      .catch(() => undefined)
    void dispatchAssignedAgents(channel.id, roomName)
  }

  // Channel moderation is role-based: owners/admins get host powers (and the
  // derived key, so every existing host-gated room route works unchanged).
  const isHost = user.role === "owner" || user.role === "admin"
  const identity = `u_${user.id}`
  const meta: ParticipantMeta = {
    kind: "human",
    ...(isHost ? { isHost: true } : {}),
    userId: user.id,
    role: user.role ?? undefined,
  }

  const { apiKey, apiSecret, publicUrl } = livekitEnv()
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: body.data.displayName,
    metadata: JSON.stringify(meta),
    ttl: "1h",
  })
  token.addGrant({
    room: roomName,
    roomJoin: true,
    roomCreate: false,
    roomAdmin: false,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
  })

  const roomStartedAt = roomMeta.startedAt ?? Date.now()

  return NextResponse.json({
    token: await token.toJwt(),
    serverUrl: publicUrl,
    identity,
    participantCount,
    waiting: false,
    isHost,
    roomStartedAt,
    hostKey: isHost ? deriveHostKey(roomName) : undefined,
  })
}
