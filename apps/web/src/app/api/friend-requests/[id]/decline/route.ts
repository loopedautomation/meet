import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { declineFriendRequest } from "@/lib/server/friendRequests"
import { getMemberUser } from "@/lib/server/session"

type Params = { params: Promise<{ id: string }> }

/** The recipient discards the request — no message, no block. Not
 * rate-limited — see the same note on the accept route: this only ever
 * touches a request the caller already owns, nothing to spam-flood. */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const declined = await declineFriendRequest(id, user.id)
  if (!declined) {
    return NextResponse.json({ error: "request not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
