import { NextResponse } from "next/server"
import { z } from "zod"
import { bridgeFetch } from "@/lib/server/bridge"
import { canManageAgents, HOST_KEY_HEADER } from "@/lib/server/host"
import { isValidRoomSlug } from "@/lib/server/slug"

type Params = { params: Promise<{ slug: string }> }

const inviteByUrlSchema = z.object({
  url: z.string().min(1),
  token: z.string().optional(),
  name: z.string().max(64).optional(),
  voice: z.string().max(32).optional(),
})

/** Ad-hoc invite: bring any looped agent into the room by its TTY URL. */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params
  if (!isValidRoomSlug(slug)) {
    return NextResponse.json({ error: "invalid room" }, { status: 400 })
  }
  const body = inviteByUrlSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!body.success) {
    return NextResponse.json({ error: "url required" }, { status: 400 })
  }
  // Same gate as the registry invites: the host can reserve agents.
  if (!(await canManageAgents(slug, request.headers.get(HOST_KEY_HEADER)))) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 })
  }
  try {
    const res = await bridgeFetch(`/rooms/${slug}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.data),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "bridge unavailable" }, { status: 502 })
  }
}
