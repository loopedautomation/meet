import { and, desc, eq, getDb, or, schema } from "@meet/db"
import { type Channel, findOrCreateDm } from "./channels"

export type FriendRequest = typeof schema.friendRequests.$inferSelect

/** A pending request paired with the other side's directory profile —
 * enough for the inbox to render a row without a second round-trip. */
export type FriendRequestWithOtherUser = {
  id: string
  status: FriendRequest["status"]
  createdAt: Date
  otherUser: {
    id: string
    name: string | null
    email: string | null
    image: string | null
  }
}

/**
 * Send a request to DM `recipientId`. Idempotent: a pending request already
 * outstanding between this pair (in either direction) is returned as-is
 * rather than duplicated — sending while the other side already has a
 * pending request to you does not auto-accept it, it just surfaces their
 * existing row. Accepting is always a separate, explicit action.
 *
 * The either-direction check below has a small window (check-then-insert,
 * not atomic) where two same-direction sends could both pass it; the DB's
 * partial unique index (`friend_requests_pending_pair_idx`) is the real
 * guard for that race, this is just the friendly no-duplicate path for the
 * common case.
 */
export async function sendFriendRequest(
  requesterId: string,
  recipientId: string,
): Promise<FriendRequest> {
  if (requesterId === recipientId) {
    throw new Error("you can't send a request to yourself")
  }
  const db = getDb()
  const existing = await db.query.friendRequests.findFirst({
    where: and(
      eq(schema.friendRequests.status, "pending"),
      or(
        and(
          eq(schema.friendRequests.requesterId, requesterId),
          eq(schema.friendRequests.recipientId, recipientId),
        ),
        and(
          eq(schema.friendRequests.requesterId, recipientId),
          eq(schema.friendRequests.recipientId, requesterId),
        ),
      ),
    ),
  })
  if (existing) return existing
  const [row] = await db
    .insert(schema.friendRequests)
    .values({ requesterId, recipientId })
    .returning()
  return row
}

/**
 * The recipient accepts — opens (or reopens) the DM. Returns null if
 * `actingUserId` isn't the recipient, or the request is no longer pending
 * (already accepted/declined/canceled, or raced with a concurrent
 * decline/cancel): the conditional update only flips a row that's still
 * pending and owned by this recipient, so a lost race is indistinguishable
 * from "not found" to the caller — both mean nothing happened.
 *
 * Not wrapped in one transaction with findOrCreateDm: if the process dies
 * between the two, the request row is left `accepted` with no channel yet,
 * which self-heals — an `accepted` row already satisfies the POST /api/dms
 * gate, so the next call (from either side, or a retried accept) creates
 * the channel lazily.
 */
export async function acceptFriendRequest(
  requestId: string,
  actingUserId: string,
): Promise<Channel | null> {
  const db = getDb()
  const [row] = await db
    .update(schema.friendRequests)
    .set({ status: "accepted", respondedAt: new Date() })
    .where(
      and(
        eq(schema.friendRequests.id, requestId),
        eq(schema.friendRequests.recipientId, actingUserId),
        eq(schema.friendRequests.status, "pending"),
      ),
    )
    .returning()
  if (!row) return null
  return findOrCreateDm([row.requesterId, row.recipientId])
}

/**
 * The recipient discards the request — no message, no block. The same
 * sender can send a fresh one later (a new row; the declined one stays as
 * history). Same null-means-lost-the-race/wrong-actor contract as accept.
 */
export async function declineFriendRequest(
  requestId: string,
  actingUserId: string,
): Promise<FriendRequest | null> {
  const db = getDb()
  const [row] = await db
    .update(schema.friendRequests)
    .set({ status: "declined", respondedAt: new Date() })
    .where(
      and(
        eq(schema.friendRequests.id, requestId),
        eq(schema.friendRequests.recipientId, actingUserId),
        eq(schema.friendRequests.status, "pending"),
      ),
    )
    .returning()
  return row ?? null
}

/**
 * Everyone this member can 1:1-DM without hitting the gate: the other side
 * of every existing 1:1 DM channel (grandfathering — no request was ever
 * needed for these) union the other side of every `accepted` request.
 * Deliberately *excludes* group-DM co-members: group DMs stay ungated as
 * their own thing (per the issue's scope), but sharing a group chat isn't
 * the same as having 1:1-connected with someone, so it doesn't waive the
 * gate for a fresh 1:1.
 *
 * This is the interface DmStart uses to render "Message" vs "Send request"
 * per member without a per-pair round trip, and mirrors (rather than reuses
 * — see POST /api/dms) the pair-specific existing-channel check there,
 * since that call site already has the one other id it cares about and
 * doesn't need a full set.
 */
export async function connectedUserIds(userId: string): Promise<Set<string>> {
  const db = getDb()
  const [dmPeers, accepted] = await Promise.all([
    db
      .select({
        channelId: schema.channelMembers.channelId,
        userId: schema.channelMembers.userId,
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.channels,
        eq(schema.channels.id, schema.channelMembers.channelId),
      )
      .where(eq(schema.channels.isDm, true)),
    db
      .select({
        requesterId: schema.friendRequests.requesterId,
        recipientId: schema.friendRequests.recipientId,
      })
      .from(schema.friendRequests)
      .where(
        and(
          eq(schema.friendRequests.status, "accepted"),
          or(
            eq(schema.friendRequests.requesterId, userId),
            eq(schema.friendRequests.recipientId, userId),
          ),
        ),
      ),
  ])

  // Group by channel so a 1:1 (exactly 2 members) can be told apart from a
  // group DM (3+) — only 1:1 membership counts here.
  const membersByChannel = new Map<string, string[]>()
  for (const row of dmPeers) {
    const list = membersByChannel.get(row.channelId) ?? []
    list.push(row.userId)
    membersByChannel.set(row.channelId, list)
  }

  const connected = new Set<string>()
  for (const members of membersByChannel.values()) {
    if (members.length !== 2 || !members.includes(userId)) continue
    for (const id of members) {
      if (id !== userId) connected.add(id)
    }
  }
  for (const row of accepted) {
    connected.add(
      row.requesterId === userId ? row.recipientId : row.requesterId,
    )
  }
  return connected
}

/** Pending requests sent *to* this member — the inbox's "Accept/Decline"
 * section. Newest first. */
export async function listIncoming(
  userId: string,
): Promise<FriendRequestWithOtherUser[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: schema.friendRequests.id,
      status: schema.friendRequests.status,
      createdAt: schema.friendRequests.createdAt,
      otherUser: {
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        image: schema.users.image,
      },
    })
    .from(schema.friendRequests)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.friendRequests.requesterId),
    )
    .where(
      and(
        eq(schema.friendRequests.recipientId, userId),
        eq(schema.friendRequests.status, "pending"),
      ),
    )
    .orderBy(desc(schema.friendRequests.createdAt))
  return rows
}

/** Pending requests this member sent — the inbox's "Cancel" section (and
 * what DmStart uses to show "Request sent" instead of "Send request").
 * Newest first. */
export async function listOutgoing(
  userId: string,
): Promise<FriendRequestWithOtherUser[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: schema.friendRequests.id,
      status: schema.friendRequests.status,
      createdAt: schema.friendRequests.createdAt,
      otherUser: {
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        image: schema.users.image,
      },
    })
    .from(schema.friendRequests)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.friendRequests.recipientId),
    )
    .where(
      and(
        eq(schema.friendRequests.requesterId, userId),
        eq(schema.friendRequests.status, "pending"),
      ),
    )
    .orderBy(desc(schema.friendRequests.createdAt))
  return rows
}

/** The requester withdraws their own still-pending request. Same
 * null-means-lost-the-race/wrong-actor contract as accept/decline. */
export async function cancelFriendRequest(
  requestId: string,
  actingUserId: string,
): Promise<FriendRequest | null> {
  const db = getDb()
  const [row] = await db
    .update(schema.friendRequests)
    .set({ status: "canceled", respondedAt: new Date() })
    .where(
      and(
        eq(schema.friendRequests.id, requestId),
        eq(schema.friendRequests.requesterId, actingUserId),
        eq(schema.friendRequests.status, "pending"),
      ),
    )
    .returning()
  return row ?? null
}
