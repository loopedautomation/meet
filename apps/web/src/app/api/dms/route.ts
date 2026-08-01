import { eq, getDb, inArray, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { findOrCreateDm } from "@/lib/server/channels"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getMemberUser } from "@/lib/server/session"

const createDmSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(9),
})

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
    return NextResponse.json({ error: "userIds required" }, { status: 400 })
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
  const dm = await findOrCreateDm([user.id, ...others])
  return NextResponse.json({ slug: dm.slug })
}
