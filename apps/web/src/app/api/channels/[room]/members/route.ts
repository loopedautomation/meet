import { asc, eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { canAccessChannel, getChannelByRoomName } from "@/lib/server/channels"
import { onlineUserIds } from "@/lib/server/onlineRegistry"
import { getMemberUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ room: string }> }

// Shared with both branches below — the same person-facing columns
// /api/members returns, so the panel can render either response with one
// shape. Only `joinedAt`'s source table (and thus sort order) differs.
const MEMBER_COLUMNS = {
  id: schema.users.id,
  name: schema.effectiveUserName,
  email: schema.users.email,
  image: schema.effectiveUserAvatar,
  statusText: schema.users.statusText,
  presence: schema.users.presence,
  role: schema.memberships.role,
}

/**
 * Channel-scoped member directory backing the text-channel member list
 * panel. Public channels are open to every member (same visibility rule
 * canAccessChannel already enforces for entry), so they get the full
 * server roster — identical shape to /api/members. Private channels,
 * including DMs, only expose the channel_members subset.
 */
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
  const rows = channel.isPrivate
    ? await db
        .select({ ...MEMBER_COLUMNS, joinedAt: schema.channelMembers.addedAt })
        .from(schema.channelMembers)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.channelMembers.userId),
        )
        .leftJoin(
          schema.memberships,
          eq(schema.memberships.userId, schema.channelMembers.userId),
        )
        .where(eq(schema.channelMembers.channelId, channel.id))
        .orderBy(asc(schema.channelMembers.addedAt))
    : await db
        .select({ ...MEMBER_COLUMNS, joinedAt: schema.memberships.createdAt })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .orderBy(asc(schema.memberships.createdAt))
  const online = onlineUserIds()
  return NextResponse.json({
    members: rows.map((m) => ({ ...m, online: online.has(m.id) })),
  })
}
