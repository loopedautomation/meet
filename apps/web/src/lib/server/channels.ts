import { and, asc, eq, getDb, inArray, isNull, schema } from "@meet/db"
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

export type Occupant = {
  identity: string
  name: string | null
  kind: string | null
}

export type ChannelWithPresence = Channel & {
  occupants: number
  occupantList: Occupant[]
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
  const presence = await db
    .select()
    .from(schema.roomPresence)
    .where(inArray(schema.roomPresence.roomName, roomNames))
  const byRoom = new Map<string, Occupant[]>()
  for (const p of presence) {
    if (p.kind === "service") continue
    const list = byRoom.get(p.roomName) ?? []
    list.push({ identity: p.identity, name: p.displayName, kind: p.kind })
    byRoom.set(p.roomName, list)
  }
  return visible.map((r) => {
    const occupantList = byRoom.get(channelRoomName(r.channel)) ?? []
    return { ...r.channel, occupants: occupantList.length, occupantList }
  })
}
