import { roomSettingsSchema } from "@meet/shared"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authorizeHost } from "@/lib/server/host"
import { roomService } from "@/lib/server/livekit"
import { isValidRoomSlug } from "@/lib/server/slug"

type Params = { params: Promise<{ slug: string }> }

const updateSchema = z.object({
  settings: roomSettingsSchema.partial(),
  /** The organiser's key, held only by the browser that created the room. */
  hostKey: z.string().min(1),
  /**
   * The organiser's LiveKit identity. Trustworthy because this route is
   * hostKey-authenticated; stamped into metadata so agent workers can
   * enforce host-only controls against the actual data-channel sender.
   */
  hostIdentity: z.string().max(128).optional(),
})

/**
 * The host's room-level settings — who besides them may drive the agents.
 *
 * They live in room metadata rather than a data message so a participant who
 * joins later is bound by them too, and so the invite routes can enforce
 * them server-side. The UI hides what a participant may not do; this is what
 * stops a crafted request from doing it anyway.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { slug } = await params
  if (!isValidRoomSlug(slug)) {
    return NextResponse.json({ error: "invalid room" }, { status: 400 })
  }
  const body = updateSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 })
  }

  const auth = await authorizeHost(slug, body.data.hostKey)
  if (!auth.ok) {
    const error = auth.status === 404 ? "room not found" : "not authorized"
    return NextResponse.json({ error }, { status: auth.status })
  }

  // Merge, so toggling one setting can't silently reset the other, and keep
  // the rest of the metadata (started, startedAt) intact. Any legacy hostKey
  // copy is stripped: metadata is public to the room, secrets can't live in
  // it.
  const settings = roomSettingsSchema.parse({
    ...auth.metadata.settings,
    ...body.data.settings,
  })
  const { hostKey: _legacy, ...rest } = auth.metadata
  const metadata = {
    ...rest,
    ...(body.data.hostIdentity ? { hostIdentity: body.data.hostIdentity } : {}),
    settings,
  }
  try {
    await roomService().updateRoomMetadata(slug, JSON.stringify(metadata))
  } catch {
    // Failing silently would tell the host a gate is up when it isn't.
    return NextResponse.json(
      { error: "settings update failed" },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, settings })
}
