import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { createServer, listServersForUser } from "@/lib/server/servers"
import { ACTIVE_SERVER_COOKIE, getSessionUser } from "@/lib/server/session"

const createServerSchema = z.object({
  name: z.string().min(1).max(80),
  iconUrl: z.string().url().max(2048).optional(),
})

/** Servers the signed-in user belongs to — the sidebar switcher's data. */
export async function GET() {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser()
  if (!user)
    return NextResponse.json({ error: "sign in first" }, { status: 401 })
  const servers = await listServersForUser(user.id)
  return NextResponse.json({ servers })
}

/** Create a server — any signed-in user may do this, becoming its owner.
 * Seeds a #general text channel and a General voice channel so there's
 * somewhere to talk the moment it's created. */
export async function POST(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser()
  if (!user)
    return NextResponse.json({ error: "sign in first" }, { status: 401 })
  if (rateLimited(`server-create:${clientKey(request)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "too many servers, slow down" },
      { status: 429 },
    )
  }
  const body = createServerSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!body.success) {
    return NextResponse.json(
      { error: "a server name is required" },
      { status: 400 },
    )
  }
  const { server, defaultChannelSlug } = await createServer({
    name: body.data.name,
    iconUrl: body.data.iconUrl,
    createdBy: user.id,
  })
  const response = NextResponse.json({
    server,
    defaultChannelSlug,
  })
  // The new server becomes active immediately — land inside it.
  response.cookies.set(ACTIVE_SERVER_COOKIE, server.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}
