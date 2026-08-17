import { and, eq, getDb, inArray, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { findOrCreateAgentDm, findOrCreateDm } from "@/lib/server/channels"
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
  if (!user || !user.serverId)
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
      where: and(
        eq(schema.serverAgents.serverId, user.serverId),
        eq(schema.serverAgents.agentId, body.data.agentId),
      ),
    })
    if (!invited) {
      return NextResponse.json(
        { error: "agent not on this server" },
        { status: 404 },
      )
    }
    const dm = await findOrCreateAgentDm(
      user.serverId,
      user.id,
      body.data.agentId,
    )
    return NextResponse.json({ slug: dm.slug })
  }
  const others = body.data.userIds.filter((id) => id !== user.id)
  if (others.length === 0) {
    return NextResponse.json(
      { error: "a DM needs someone else in it" },
      { status: 400 },
    )
  }
  // Every participant must be a member of this same server — a DM can't
  // reach outside it.
  const memberRows = await getDb()
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.serverId, user.serverId),
        inArray(schema.memberships.userId, others),
      ),
    )
  if (memberRows.length !== others.length) {
    return NextResponse.json({ error: "unknown member" }, { status: 400 })
  }
  const dm = await findOrCreateDm(user.serverId, [user.id, ...others])
  return NextResponse.json({ slug: dm.slug })
}
