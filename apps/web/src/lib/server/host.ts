import { timingSafeEqual } from "node:crypto"
import {
  type RoomMetadata,
  type RoomSettings,
  roomMetadataSchema,
  roomSettingsSchema,
} from "@meet/shared"
import { roomService } from "@/lib/server/livekit"
import { deriveHostKey } from "@/lib/server/slug"

/** Header carrying the organiser's key on host-gated agent routes. */
export const HOST_KEY_HEADER = "x-host-key"

function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function parseRoomMetadata(raw: string | undefined): RoomMetadata {
  try {
    return roomMetadataSchema.parse(JSON.parse(raw || "{}"))
  } catch {
    return {}
  }
}

/**
 * Resolves a room and checks the organiser's key against it. Host-only
 * routes enforce server-side rather than trusting a claimed identity — the
 * host key never leaves the creator's browser.
 *
 * Returns the room's metadata on success so callers can update it without a
 * second lookup, or an HTTP status to return as-is.
 */
export async function authorizeHost(
  slug: string,
  hostKey: string,
): Promise<
  { ok: true; metadata: RoomMetadata } | { ok: false; status: 403 | 404 }
> {
  const rooms = await roomService()
    .listRooms([slug])
    .catch(() => [])
  if (rooms.length === 0) return { ok: false, status: 404 }

  const metadata = parseRoomMetadata(rooms[0].metadata)
  // Always the derived key: room metadata is broadcast to every participant,
  // so a key stored there is public and must never authorise anything.
  if (!keyMatches(hostKey, deriveHostKey(slug))) {
    return { ok: false, status: 403 }
  }
  return { ok: true, metadata }
}

/**
 * Whether this request may invite or remove agents: everyone can, unless the
 * host has turned that off, in which case only the host's key gets through.
 *
 * Fails closed: a room that can't be found or whose settings can't be read
 * admits only the host key. Granting the permissive default on an error
 * would turn a LiveKit hiccup into an authorization bypass.
 */
export async function canManageAgents(
  slug: string,
  hostKey: string | null,
): Promise<boolean> {
  const rooms = await roomService()
    .listRooms([slug])
    .catch(() => null)
  let settings: RoomSettings | null = null
  if (rooms?.[0]) {
    try {
      settings = roomSettingsSchema.parse(
        parseRoomMetadata(rooms[0].metadata).settings ?? {},
      )
    } catch {
      settings = null
    }
  }
  if (settings?.participantsCanInviteAgents) return true
  if (!hostKey) return false
  return (await authorizeHost(slug, hostKey)).ok
}
