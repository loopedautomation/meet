import { timingSafeEqual } from "node:crypto"
import { nanoid } from "nanoid"
import { NextResponse } from "next/server"
import { roomService } from "@/lib/server/livekit"
import { generateRoomSlug } from "@/lib/server/slug"

/**
 * Meeting creation is gated by a management password when
 * MEET_MANAGEMENT_PASSWORD is set: only people who have it can create rooms;
 * anyone with a room link can still join freely. Leave it unset for a fully
 * open deployment.
 */
function authorized(request: Request): boolean {
  const required = process.env.MEET_MANAGEMENT_PASSWORD
  if (!required) return true
  const given = request.headers.get("x-management-password") ?? ""
  const a = Buffer.from(given)
  const b = Buffer.from(required)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "management password required" },
      { status: 401 },
    )
  }
  const slug = generateRoomSlug()
  // The meeting starts when its creator arrives: the hostKey goes back to
  // the creator's browser, and the token route holds everyone else at
  // "hasn't started yet" until a request presents it (see [slug]/token).
  const hostKey = nanoid(24)
  await roomService().createRoom({
    name: slug,
    emptyTimeout: 300,
    departureTimeout: 60,
    metadata: JSON.stringify({ hostKey, started: false }),
  })
  // Share links use the short-link base when configured (e.g.
  // https://lpd.sh/meet, redirected at the edge), else this deployment's URL.
  const base = process.env.SHARE_LINK_BASE?.replace(/\/$/, "")
  const url = base
    ? `${base}/${slug}`
    : new URL(`/r/${slug}`, request.url).toString()
  return NextResponse.json({ slug, url, hostKey })
}
