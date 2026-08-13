import { eq, getDb, inArray, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import {
  dmSlugFor,
  findOrCreateAgentDm,
  findOrCreateDm,
  getChannelBySlug,
} from "@/lib/server/channels"
import { connectedUserIds } from "@/lib/server/friendRequests"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getMemberUser } from "@/lib/server/session"

const createDmSchema = z.union([
  z.object({ userIds: z.array(z.string().uuid()).min(1).max(9) }),
  z.object({ agentId: z.string().regex(/^[a-z0-9-]+$/) }),
])

/** Open (or create) the DM between you and the given members — always the
 * same conversation for the same people. */
export async function POST(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  if (rateLimited(`dm-create:${clientKey(request)}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 })
  }
  const body = createDmSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json(
      { error: "userIds or agentId required" },
      { status: 400 },
    )
  // DM an agent: it must be invited to the server first.
  if ("agentId" in body.data) {
    const invited = await getDb().query.serverAgents.findFirst({
      where: eq(schema.serverAgents.agentId, body.data.agentId),
    })
    if (!invited) {
      return NextResponse.json(
        { error: "agent not on this server" },
        { status: 404 },
      )
    }
    const dm = await findOrCreateAgentDm(user.id, body.data.agentId)
    return NextResponse.json({ slug: dm.slug })
  }
  const others = body.data.userIds.filter((id) => id !== user.id)
  if (others.length === 0) {
    return NextResponse.json(
      { error: "a DM needs someone else in it" },
      { status: 400 },
    )
  }
  // Every participant must be an instance member — a DM can't reach outside.
  const memberRows = await getDb()
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(inArray(schema.memberships.userId, others))
  if (memberRows.length !== others.length) {
    return NextResponse.json({ error: "unknown member" }, { status: 400 })
  }
  // The friend-request gate: 1:1 human DMs only (group DMs — others.length
  // > 1 — stay ungated, out of scope for #284). An existing DM channel for
  // this exact pair always wins first, so every DM that predates this
  // feature keeps working with zero migration/backfill.
  if (others.length === 1) {
    const existing = await getChannelBySlug(dmSlugFor([user.id, others[0]]))
    if (!existing) {
      const connected = await connectedUserIds(user.id)
      if (!connected.has(others[0])) {
        return NextResponse.json(
          { error: "friend request required", code: "request_required" },
          { status: 403 },
        )
      }
    }
  }
  const dm = await findOrCreateDm([user.id, ...others])
  return NextResponse.json({ slug: dm.slug })
}
