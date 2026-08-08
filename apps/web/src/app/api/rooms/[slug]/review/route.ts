import { NextResponse } from "next/server"
import { bridgeFetch } from "@/lib/server/bridge"
import { isKicked } from "@/lib/server/kicked"
import { verifyParticipant } from "@/lib/server/participantAuth"
import { isValidRoomSlug } from "@/lib/server/slug"

type Params = { params: Promise<{ slug: string }> }

/**
 * The room's review state (concern/revision ledger plus the current PR's
 * metadata, patches stripped) — proxied to the bridge review store. Live
 * notifications ride DataTopic.Review; this is what a refetch, a late
 * joiner, or a reconnect reads.
 */
export async function GET(request: Request, { params }: Params) {
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
  try {
    const res = await bridgeFetch(`/rooms/${slug}/review`)
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "bridge unavailable" }, { status: 502 })
  }
}
