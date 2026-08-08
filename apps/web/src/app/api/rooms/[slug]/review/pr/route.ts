import { NextResponse } from "next/server"
import { bridgeFetch } from "@/lib/server/bridge"
import { isKicked } from "@/lib/server/kicked"
import { verifyParticipant } from "@/lib/server/participantAuth"
import { isValidRoomSlug } from "@/lib/server/slug"

type Params = { params: Promise<{ slug: string }> }

/**
 * A full PR snapshot (with per-file patches) by headSha. Snapshots are
 * immutable per sha, so clients cache by sha and only fetch new ones; the
 * bridge serves only the current or previous sha.
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
  const sha = new URL(request.url).searchParams.get("sha")
  if (!sha || sha.length > 64) {
    return NextResponse.json({ error: "sha required" }, { status: 400 })
  }
  try {
    const res = await bridgeFetch(
      `/rooms/${slug}/review/pr?sha=${encodeURIComponent(sha)}`,
    )
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "bridge unavailable" }, { status: 502 })
  }
}
