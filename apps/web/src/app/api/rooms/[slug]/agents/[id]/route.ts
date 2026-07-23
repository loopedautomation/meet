import { NextResponse } from "next/server"
import { bridgeFetch } from "@/lib/server/bridge"
import { canManageAgents, HOST_KEY_HEADER } from "@/lib/server/host"
import { isKicked } from "@/lib/server/kicked"
import { verifyParticipant } from "@/lib/server/participantAuth"
import { isValidRoomSlug } from "@/lib/server/slug"

type Params = { params: Promise<{ slug: string; id: string }> }

async function forward(
  method: "POST" | "DELETE",
  request: Request,
  { params }: Params,
  body?: string,
) {
  const { slug, id } = await params
  if (!isValidRoomSlug(slug) || !/^[a-z0-9-]+$/.test(id)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 })
  }
  // The caller must be an admitted member of this meeting; agents receive
  // the room's audio and context, so slug knowledge alone can't invite one.
  const participant = await verifyParticipant(request, slug)
  if (
    !participant ||
    participant.kind !== "human" ||
    isKicked(slug, participant.identity)
  ) {
    return NextResponse.json({ error: "not authorized" }, { status: 401 })
  }
  // The host may have reserved agents for themselves. Enforced here and not
  // only in the UI, or the setting is decoration.
  if (!(await canManageAgents(slug, request.headers.get(HOST_KEY_HEADER)))) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 })
  }
  try {
    const res = await bridgeFetch(`/rooms/${slug}/agents/${id}`, {
      method,
      ...(body
        ? { body, headers: { "content-type": "application/json" } }
        : {}),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "bridge unavailable" }, { status: 502 })
  }
}

export async function POST(request: Request, ctx: Params) {
  const body = await request.text().catch(() => "")
  return forward("POST", request, ctx, body || undefined)
}

export async function DELETE(request: Request, ctx: Params) {
  return forward("DELETE", request, ctx)
}
