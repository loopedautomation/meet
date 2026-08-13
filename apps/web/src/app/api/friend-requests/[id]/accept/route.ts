import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { acceptFriendRequest } from "@/lib/server/friendRequests"
import { getMemberUser } from "@/lib/server/session"

type Params = { params: Promise<{ id: string }> }

/**
 * The recipient accepts — opens the DM, same response shape as
 * POST /api/dms so the client's "navigate into the conversation" code path
 * is identical either way.
 *
 * Not rate-limited like POST /api/friend-requests is: the abuse surface
 * there is *creating* requests (spamming strangers); this only ever acts
 * on a request row the caller is already the recipient of, so there's
 * nothing to spam-flood by hammering it.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const channel = await acceptFriendRequest(id, user.id)
  if (!channel) {
    return NextResponse.json({ error: "request not found" }, { status: 404 })
  }
  return NextResponse.json({ slug: channel.slug })
}
