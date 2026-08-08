import {
  AGENT_ONLY_REVIEW_OPS,
  HOST_RESERVABLE_REVIEW_OPS,
  reviewOpSchema,
} from "@meet/shared/review"
import { NextResponse } from "next/server"
import { bridgeFetch } from "@/lib/server/bridge"
import { canResolveReviews, HOST_KEY_HEADER } from "@/lib/server/host"
import { isKicked } from "@/lib/server/kicked"
import { verifyParticipant } from "@/lib/server/participantAuth"
import { isValidRoomSlug } from "@/lib/server/slug"

type Params = { params: Promise<{ slug: string }> }

/**
 * Human review ops. The client sends a bare op — never an envelope — and
 * this route stamps the actor from the caller's verified LiveKit token, so
 * an op can't claim to be anyone else. Agent-only ops (push-snapshot,
 * revision-*) are rejected outright: those enter through the agent worker.
 *
 * After a 200 the CLIENT broadcasts review-sync on the data channel — it's
 * in the room; this route isn't.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params
  if (!isValidRoomSlug(slug)) {
    return NextResponse.json({ error: "invalid room" }, { status: 400 })
  }
  const participant = await verifyParticipant(request, slug)
  if (
    !participant ||
    participant.kind !== "human" ||
    isKicked(slug, participant.identity)
  ) {
    return NextResponse.json({ error: "not authorized" }, { status: 401 })
  }

  const parsed = reviewOpSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid op" }, { status: 400 })
  }
  const op = parsed.data
  if (AGENT_ONLY_REVIEW_OPS.has(op.op)) {
    return NextResponse.json(
      { error: `${op.op} is agent-only` },
      { status: 403 },
    )
  }
  if (HOST_RESERVABLE_REVIEW_OPS.has(op.op)) {
    const allowed = await canResolveReviews(
      slug,
      request.headers.get(HOST_KEY_HEADER),
    )
    if (!allowed) {
      return NextResponse.json(
        { error: "the host has reserved review decisions" },
        { status: 403 },
      )
    }
  }

  try {
    const res = await bridgeFetch(`/rooms/${slug}/review/ops`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: {
          identity: participant.identity,
          name: participant.name,
          kind: "human",
        },
        op,
      }),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "bridge unavailable" }, { status: 502 })
  }
}
