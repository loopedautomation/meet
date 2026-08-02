import { createHash } from "node:crypto"
import { and, asc, eq, getDb, inArray, isNull, schema, sql } from "@meet/db"
import { customAlphabet } from "nanoid"

// Lowercase alphanumeric so the LiveKit room name ch-<publicId> passes
// isValidRoomSlug and survives every code path that sees room names.
const publicId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12)

export const CHANNEL_ROOM_PREFIX = "ch-"

export type Channel = typeof schema.channels.$inferSelect

export function channelRoomName(channel: Pick<Channel, "publicId">): string {
  return `${CHANNEL_ROOM_PREFIX}${channel.publicId}`
}

export function isChannelRoomName(roomName: string): boolean {
  return roomName.startsWith(CHANNEL_ROOM_PREFIX)
}

/** Channel slugs are the #handle: lowercase, digits, hyphens. */
export function isValidChannelSlug(slug: string): boolean {
  return (
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) &&
    slug.length >= 2 &&
    slug.length <= 32
  )
}

export async function getChannelByRoomName(
  roomName: string,
): Promise<Channel | null> {
  if (!isChannelRoomName(roomName)) return null
  const channel = await getDb().query.channels.findFirst({
    where: eq(
      schema.channels.publicId,
      roomName.slice(CHANNEL_ROOM_PREFIX.length),
    ),
  })
  return channel ?? null
}

export async function getChannelBySlug(slug: string): Promise<Channel | null> {
  const channel = await getDb().query.channels.findFirst({
    where: eq(schema.channels.slug, slug),
  })
  return channel ?? null
}

/** Whether this member may enter the channel. Public channels are open to
 * every member; private ones require a channel_members row. */
export async function canAccessChannel(
  channel: Channel,
  userId: string,
): Promise<boolean> {
  if (channel.archivedAt) return false
  if (!channel.isPrivate) return true
  const row = await getDb().query.channelMembers.findFirst({
    where: and(
      eq(schema.channelMembers.channelId, channel.id),
      eq(schema.channelMembers.userId, userId),
    ),
  })
  return Boolean(row)
}

export async function createChannel(opts: {
  slug: string
  name: string
  kind?: "voice" | "text"
  topic?: string
  isPrivate?: boolean
  createdBy: string
}): Promise<Channel> {
  const [channel] = await getDb()
    .insert(schema.channels)
    .values({
      publicId: publicId(),
      slug: opts.slug,
      name: opts.name,
      kind: opts.kind ?? "voice",
      topic: opts.topic ?? null,
      isPrivate: opts.isPrivate ?? false,
      createdBy: opts.createdBy,
    })
    .returning()
  return channel
}

/**
 * A DM is a private text channel between a fixed set of people, addressed
 * deterministically: the same members always land in the same conversation.
 * Creation is idempotent by construction (unique slug from sorted ids).
 */
export async function findOrCreateDm(memberIds: string[]): Promise<Channel> {
  const ids = [...new Set(memberIds)].sort()
  if (ids.length < 2) throw new Error("a DM needs at least two people")
  const slug = `dm-${createHash("sha256").update(ids.join(":")).digest("hex").slice(0, 16)}`
  const db = getDb()
  const existing = await db.query.channels.findFirst({
    where: eq(schema.channels.slug, slug),
  })
  if (existing) return existing
  return await db.transaction(async (tx) => {
    const [channel] = await tx
      .insert(schema.channels)
      .values({
        publicId: publicId(),
        slug,
        name: "Direct message",
        kind: "text",
        isPrivate: true,
        isDm: true,
      })
      .onConflictDoNothing({ target: schema.channels.slug })
      .returning()
    if (!channel) {
      // Lost a concurrent-create race — the winner's row is the DM.
      const winner = await tx.query.channels.findFirst({
        where: eq(schema.channels.slug, slug),
      })
      if (!winner) throw new Error("dm creation raced and lost")
      return winner
    }
    await tx
      .insert(schema.channelMembers)
      .values(ids.map((userId) => ({ channelId: channel.id, userId })))
      .onConflictDoNothing()
    return channel
  })
}

/** A DM with an agent: you're the only human member; the agent is attached
 * via channel_agents and answers every message. Deterministic like any DM. */
export async function findOrCreateAgentDm(
  userId: string,
  agentId: string,
): Promise<Channel> {
  const slug = `dm-${createHash("sha256").update(`u:${userId}:a:${agentId}`).digest("hex").slice(0, 16)}`
  const db = getDb()
  const existing = await db.query.channels.findFirst({
    where: eq(schema.channels.slug, slug),
  })
  if (existing) return existing
  return await db.transaction(async (tx) => {
    const [channel] = await tx
      .insert(schema.channels)
      .values({
        publicId: publicId(),
        slug,
        name: "Direct message",
        kind: "text",
        isPrivate: true,
        isDm: true,
      })
      .onConflictDoNothing({ target: schema.channels.slug })
      .returning()
    if (!channel) {
      const winner = await tx.query.channels.findFirst({
        where: eq(schema.channels.slug, slug),
      })
      if (!winner) throw new Error("agent dm creation raced and lost")
      return winner
    }
    await tx
      .insert(schema.channelMembers)
      .values({ channelId: channel.id, userId })
      .onConflictDoNothing()
    await tx
      .insert(schema.channelAgents)
      .values({ channelId: channel.id, agentId, addedBy: userId })
      .onConflictDoNothing()
    return channel
  })
}

export type Occupant = {
  identity: string
  name: string | null
  kind: string | null
}

export type ChannelWithPresence = Channel & {
  occupants: number
  occupantList: Occupant[]
  /** Names of the other people in a DM — the conversation's label. */
  dmPeers: string[]
  /** A message newer than the viewer's last read exists. */
  unread: boolean
}

/** Channels this member can see, with live occupancy from room_presence
 * (fed by the LiveKit webhook — humans and agents count, services don't). */
export async function listChannelsForUser(
  userId: string,
): Promise<ChannelWithPresence[]> {
  const db = getDb()
  const rows = await db
    .select({
      channel: schema.channels,
      memberRow: schema.channelMembers.userId,
    })
    .from(schema.channels)
    .leftJoin(
      schema.channelMembers,
      and(
        eq(schema.channelMembers.channelId, schema.channels.id),
        eq(schema.channelMembers.userId, userId),
      ),
    )
    .where(isNull(schema.channels.archivedAt))
    .orderBy(asc(schema.channels.position), asc(schema.channels.createdAt))
  const visible = rows.filter(
    (r) => !r.channel.isPrivate || r.memberRow !== null,
  )
  if (visible.length === 0) return []

  // One presence fetch for every visible channel's room; services stay
  // invisible here just like everywhere else in the product.
  const roomNames = visible.map((r) => channelRoomName(r.channel))
  const channelIds = visible.map((r) => r.channel.id)
  const [presence, dmPeerRows, activity, reads, agentRows] = await Promise.all([
    db
      .select()
      .from(schema.roomPresence)
      .where(inArray(schema.roomPresence.roomName, roomNames)),
    // DM labels: the other members' names.
    db
      .select({
        channelId: schema.channelMembers.channelId,
        userId: schema.channelMembers.userId,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.channelMembers.userId),
      )
      .where(inArray(schema.channelMembers.channelId, channelIds)),
    // Latest message per channel — unread detection.
    db
      .select({
        channelId: schema.messages.channelId,
        lastAt: sql<string>`max(${schema.messages.createdAt})`,
      })
      .from(schema.messages)
      .where(inArray(schema.messages.channelId, channelIds))
      .groupBy(schema.messages.channelId),
    db
      .select()
      .from(schema.channelReads)
      .where(
        and(
          inArray(schema.channelReads.channelId, channelIds),
          eq(schema.channelReads.userId, userId),
        ),
      ),
    // Agents attached to DMs label the conversation ("Scout").
    db
      .select({
        channelId: schema.channelAgents.channelId,
        agentId: schema.channelAgents.agentId,
        agentName: schema.serverAgents.name,
      })
      .from(schema.channelAgents)
      .leftJoin(
        schema.serverAgents,
        eq(schema.serverAgents.agentId, schema.channelAgents.agentId),
      )
      .where(inArray(schema.channelAgents.channelId, channelIds)),
  ])
  const byRoom = new Map<string, Occupant[]>()
  for (const p of presence) {
    if (p.kind === "service") continue
    const list = byRoom.get(p.roomName) ?? []
    list.push({ identity: p.identity, name: p.displayName, kind: p.kind })
    byRoom.set(p.roomName, list)
  }
  const peersByChannel = new Map<string, string[]>()
  for (const row of dmPeerRows) {
    if (row.userId === userId) continue
    const list = peersByChannel.get(row.channelId) ?? []
    list.push(row.name ?? row.email ?? "someone")
    peersByChannel.set(row.channelId, list)
  }
  for (const row of agentRows) {
    const list = peersByChannel.get(row.channelId) ?? []
    list.push(row.agentName ?? row.agentId)
    peersByChannel.set(row.channelId, list)
  }
  const lastActivity = new Map(
    activity.map((a) => [a.channelId, new Date(a.lastAt).getTime()]),
  )
  const lastRead = new Map(
    reads.map((r) => [r.channelId, r.lastReadAt.getTime()]),
  )
  return visible.map((r) => {
    const occupantList = byRoom.get(channelRoomName(r.channel)) ?? []
    const lastAt = lastActivity.get(r.channel.id)
    return {
      ...r.channel,
      occupants: occupantList.length,
      occupantList,
      dmPeers: r.channel.isDm ? (peersByChannel.get(r.channel.id) ?? []) : [],
      unread:
        lastAt !== undefined && lastAt > (lastRead.get(r.channel.id) ?? 0),
    }
  })
}
