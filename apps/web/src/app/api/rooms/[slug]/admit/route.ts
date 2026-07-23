import type { ParticipantMeta } from "@meet/shared"
import { parseParticipantMeta } from "@meet/shared"
import { NextResponse } from "next/server"
import { z } from "zod"
import { roomService } from "@/lib/server/livekit"
import { verifyParticipant } from "@/lib/server/participantAuth"
import { isValidRoomSlug } from "@/lib/server/slug"

type Params = { params: Promise<{ slug: string }> }

const admitSchema = z.object({
  identity: z.string().min(1),
  action: z.enum(["admit", "deny"]),
})

/**
 * Admit or deny a waiting participant. Anyone already admitted to the meeting
 * may approve (per current product decision — no host-only gating yet).
 *
 * The requester is the caller's own cryptographically verified LiveKit token
 * (Authorization header), never a claimed identity in the body — a waiting
 * user who can guess a connected identity must not be able to admit
 * themselves or deny others.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params
  if (!isValidRoomSlug(slug)) {
    return NextResponse.json({ error: "invalid room" }, { status: 400 })
  }
  const body = admitSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 })
  }
  const { identity, action } = body.data

  const requester = await verifyParticipant(request, slug)
  if (!requester) {
    return NextResponse.json({ error: "not authorized" }, { status: 401 })
  }

  const participants = await roomService()
    .listParticipants(slug)
    .catch(() => null)
  if (!participants) {
    return NextResponse.json({ error: "room not found" }, { status: 404 })
  }
  // The token's own metadata may still say "waiting" right after admission,
  // so the live participant record is authoritative: the caller must be
  // connected to this room as an admitted human right now.
  const live = participants.find((p) => p.identity === requester.identity)
  if (!live || parseParticipantMeta(live.metadata)?.kind !== "human") {
    return NextResponse.json({ error: "not authorized" }, { status: 403 })
  }
  const target = participants.find((p) => p.identity === identity)
  if (!target || parseParticipantMeta(target.metadata)?.kind !== "waiting") {
    return NextResponse.json({ error: "not waiting" }, { status: 404 })
  }

  if (action === "deny") {
    try {
      await roomService().removeParticipant(slug, identity)
    } catch {
      // A swallowed failure would report a denial that didn't happen.
      return NextResponse.json({ error: "deny failed" }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  }

  const meta: ParticipantMeta = { kind: "human" }
  await roomService().updateParticipant(slug, identity, {
    metadata: JSON.stringify(meta),
    permission: {
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: [],
      // Admitted participants can raise their hand / set attributes, matching
      // the grant fresh joiners get in the token route.
      canUpdateMetadata: true,
      hidden: false,
      canSubscribeMetrics: false,
      recorder: false,
      agent: false,
    },
  })
  return NextResponse.json({ ok: true })
}
