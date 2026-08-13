import { eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import {
  connectedUserIds,
  listIncoming,
  listOutgoing,
  sendFriendRequest,
} from "@/lib/server/friendRequests"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getMemberUser } from "@/lib/server/session"

const sendSchema = z.object({ recipientId: z.string().uuid() })

/** The signed-in member's message-request state: what's in their inbox
 * (incoming to accept/decline, outgoing to cancel) plus who they're
 * already connected to — DmStart uses the latter to decide "Message" vs
 * "Send request" per member without a round trip per person. */
export async function GET() {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const [incoming, outgoing, connected] = await Promise.all([
    listIncoming(user.id),
    listOutgoing(user.id),
    connectedUserIds(user.id),
  ])
  return NextResponse.json({
    incoming,
    outgoing,
    connectedUserIds: [...connected],
  })
}

/** Send a bare "X wants to DM you" request — no message body. */
export async function POST(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  if (
    rateLimited(
      `friend-request-create:${clientKey(request)}`,
      20,
      60 * 60 * 1000,
    )
  ) {
    return NextResponse.json({ error: "slow down" }, { status: 429 })
  }
  const body = sendSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "recipientId required" }, { status: 400 })
  const { recipientId } = body.data
  if (recipientId === user.id) {
    return NextResponse.json(
      { error: "you can't send a request to yourself" },
      { status: 400 },
    )
  }
  const member = await getDb().query.memberships.findFirst({
    where: eq(schema.memberships.userId, recipientId),
  })
  if (!member) {
    return NextResponse.json({ error: "unknown member" }, { status: 400 })
  }
  const req = await sendFriendRequest(user.id, recipientId)
  return NextResponse.json(req)
}
