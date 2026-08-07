import { NextResponse } from "next/server"
import { bridgeFetch } from "@/lib/server/bridge"
import { bridgeAgentBody } from "@/lib/server/externalAgents"
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
    // The client's body carries only overrides (mode/voice); for external
    // ("ext-…") agents the server attaches the decrypted dial spec here —
    // the browser never sees agent URLs or tokens.
    let forwarded = body
    let hasBody = Boolean(body)
    if (method === "POST" && id.startsWith("ext-")) {
      let overrides: Record<string, unknown> = {}
      try {
        overrides = body ? JSON.parse(body) : {}
      } catch {}
      forwarded = JSON.stringify(await bridgeAgentBody(id, overrides))
      hasBody = true
    }
    const res = await bridgeFetch(`/rooms/${slug}/agents/${id}`, {
      method,
      ...(hasBody && forwarded
        ? { body: forwarded, headers: { "content-type": "application/json" } }
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
