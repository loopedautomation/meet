import { TrackSource } from "livekit-server-sdk"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authorizeHost } from "@/lib/server/host"
import { recordKicked } from "@/lib/server/kicked"
import { roomService } from "@/lib/server/livekit"
import { isValidRoomSlug } from "@/lib/server/slug"

type Params = { params: Promise<{ slug: string }> }

const moderateSchema = z.object({
  identity: z.string().min(1),
  action: z.enum(["remove", "mute"]),
  /** The organiser's key, held only by the browser that created the room. */
  hostKey: z.string().min(1),
})

/**
 * Moderation actions on another participant — the organiser's alone, and
 * enforced server-side with the host key rather than by trusting a claimed
 * identity (as admit does).
 *
 * Removing disconnects someone; they can follow the link again but land in
 * the waiting room like any newcomer. Muting is deliberately one-way: a host
 * can silence a hot mic, but only its owner can turn it back on.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params
  if (!isValidRoomSlug(slug)) {
    return NextResponse.json({ error: "invalid room" }, { status: 400 })
  }
  const body = moderateSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 })
  }
  const { identity, action, hostKey } = body.data

  const auth = await authorizeHost(slug, hostKey)
  if (!auth.ok) {
    const error = auth.status === 404 ? "room not found" : "not authorized"
    return NextResponse.json({ error }, { status: auth.status })
  }

  if (action === "remove") {
    // Recorded before the disconnect: the identity's still-valid token must
    // stop counting as rejoin proof (see the token route), or a kicked user
    // walks straight back in under a fresh identity.
    recordKicked(slug, identity)
    try {
      await roomService().removeParticipant(slug, identity)
    } catch {
      // Failing silently here would report a removal that didn't happen.
      return NextResponse.json({ error: "remove failed" }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  }

  // Mute: find the participant's live microphone publication and silence it.
  const participants = await roomService()
    .listParticipants(slug)
    .catch(() => [])
  const target = participants.find((p) => p.identity === identity)
  const mic = target?.tracks.find(
    (t) => t.source === TrackSource.MICROPHONE && !t.muted,
  )
  if (!mic) {
    return NextResponse.json({ ok: true, alreadyMuted: true })
  }
  try {
    await roomService().mutePublishedTrack(slug, identity, mic.sid, true)
  } catch {
    // A swallowed failure would tell the host a hot mic went silent.
    return NextResponse.json({ error: "mute failed" }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
