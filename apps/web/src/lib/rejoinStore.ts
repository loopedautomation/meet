import type { JoinPreferences } from "@/components/room/RoomClient"

/**
 * Sole owner of the stored rejoin proof — the LiveKit token a participant
 * presents to resume a meeting and to authenticate room-scoped API routes
 * (admit, doc, canvas, agents; see lib/roomAuth).
 *
 * It exists because the reader and the writer silently disagreed: the proof
 * was written to localStorage while roomAuthHeaders read sessionStorage, so
 * every authenticated room route went out with no Authorization header and
 * answered 401 — surfacing only as "could not admit participant" (#259).
 * Nothing outside this module may touch the storage key.
 *
 * sessionStorage, deliberately: the proof is a bearer credential that also
 * grants entry past the waiting room, so it should not outlive the tab that
 * earned it. The cost is that closing the tab (or opening the meeting in a
 * second one) returns to the lobby and, in a gated meeting, knocks again;
 * a reload — the common case — still resumes, since sessionStorage survives it.
 */

/** Tokens carry a 1h TTL (see the token route); past that the server would
 * refuse the proof and mint a fresh identity, so a silent auto-join would be
 * pure bypass. */
export const REJOIN_MAX_AGE_MS = 60 * 60 * 1000

export type StoredRejoin = {
  prefs: JoinPreferences
  rejoinToken?: string
  savedAt?: number
}

const key = (slug: string) => `rejoin:${slug}`

/**
 * One-time import of a proof written by the pre-sessionStorage code, which
 * kept it in localStorage. Besides carrying a mid-meeting user across the
 * deploy instead of bouncing them to the lobby, this is a cleanup with teeth:
 * the entry is a live bearer credential, and nothing else would ever delete
 * it from localStorage. Freshness still gates any auto-join (isRejoinFresh),
 * so a months-old leftover can't walk past the lobby.
 */
function migrateLegacyEntry(slug: string): string | null {
  try {
    const raw = localStorage.getItem(key(slug))
    if (raw !== null) {
      // Copy before evicting: a failed write must leave the proof where it
      // was, to be retried on the next read, not destroy it.
      sessionStorage.setItem(key(slug), raw)
      localStorage.removeItem(key(slug))
    }
    return raw
  } catch {
    return null
  }
}

/** The stored proof for this room, or null when absent/unreadable. */
export function readRejoin(slug: string): StoredRejoin | null {
  try {
    const raw = sessionStorage.getItem(key(slug)) ?? migrateLegacyEntry(slug)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    // Older entries stored the preferences at the top level.
    return parsed.prefs ? (parsed as StoredRejoin) : { prefs: parsed }
  } catch {
    return null
  }
}

/** Save the proof, stamping the moment it was issued. */
export function writeRejoin(
  slug: string,
  entry: { prefs: JoinPreferences; rejoinToken?: string },
): void {
  try {
    sessionStorage.setItem(
      key(slug),
      JSON.stringify({ ...entry, savedAt: Date.now() }),
    )
    // A fresh proof supersedes any pre-migration copy of the old one.
    localStorage.removeItem(key(slug))
  } catch {}
}

export function clearRejoin(slug: string): void {
  try {
    sessionStorage.removeItem(key(slug))
    // A pre-migration entry may still sit in localStorage; a clear must
    // revoke that copy of the credential too.
    localStorage.removeItem(key(slug))
  } catch {}
}

/**
 * Drop the proof only if it is still the one this session wrote last. On
 * DUPLICATE_IDENTITY another tab has taken over the identity and saved its
 * own fresher proof; deleting that would log the live tab out.
 */
export function clearRejoinIfToken(
  slug: string,
  token: string | null | undefined,
): void {
  const stored = readRejoin(slug)
  if (!stored) return
  if (!stored.rejoinToken || stored.rejoinToken === token) clearRejoin(slug)
}

/** Whether a stored proof is recent enough to walk straight past the lobby. */
export function isRejoinFresh(stored: StoredRejoin | null): boolean {
  return (
    typeof stored?.savedAt === "number" &&
    Date.now() - stored.savedAt <= REJOIN_MAX_AGE_MS
  )
}

/** The bearer token for room-scoped API routes, when one is stored. */
export function rejoinToken(slug: string): string | undefined {
  return readRejoin(slug)?.rejoinToken
}
