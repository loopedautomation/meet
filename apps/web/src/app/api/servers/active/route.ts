import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { canAccessServer } from "@/lib/server/servers"
import { ACTIVE_SERVER_COOKIE, getSessionUser } from "@/lib/server/session"

const switchSchema = z.object({ serverId: z.string().uuid() })

/** Switch the sidebar's active server — the rail's click handler. */
export async function POST(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser()
  if (!user)
    return NextResponse.json({ error: "sign in first" }, { status: 401 })
  const body = switchSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "serverId required" }, { status: 400 })
  const allowed = await canAccessServer(body.data.serverId, user.id)
  if (!allowed)
    return NextResponse.json(
      { error: "not a member of that server" },
      { status: 403 },
    )
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ACTIVE_SERVER_COOKIE, body.data.serverId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}
