import { timingSafeEqual } from "node:crypto"
import {
  defaultRoomSettings,
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
  // Rooms carry the key they were created with; fall back to the derived one
  // so a room recreated after garbage collection still authorises its host.
  const expected = metadata.hostKey ?? deriveHostKey(slug)
  if (!keyMatches(hostKey, expected)) return { ok: false, status: 403 }
  return { ok: true, metadata }
}

/**
 * Whether this request may invite or remove agents: everyone can, unless the
 * host has turned that off, in which case only the host's key gets through.
 *
 * A missing room falls back to the defaults rather than refusing — the invite
 * routes forward to the bridge, which is the component that actually knows
 * whether the room exists.
 */
export async function canManageAgents(
  slug: string,
  hostKey: string | null,
): Promise<boolean> {
  const rooms = await roomService()
    .listRooms([slug])
    .catch(() => [])
  const settings: RoomSettings = rooms[0]
    ? roomSettingsSchema.parse(
        parseRoomMetadata(rooms[0].metadata).settings ?? {},
      )
    : defaultRoomSettings
  if (settings.participantsCanInviteAgents) return true
  if (!hostKey) return false
  return (await authorizeHost(slug, hostKey)).ok
}
