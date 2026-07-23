/**
 * Identities removed from a room by moderation. A removed participant's
 * still-valid JWT must stop counting as proof of admission — without this a
 * kicked user can silently re-mint a fresh token from the old one.
 *
 * In-memory and per-process: correct for the single-instance deployments
 * this app targets. A multi-instance deployment needs this in a shared
 * store (tracked as a known limitation).
 */
const TTL_MS = 3 * 60 * 60 * 1000 // outlives any token TTL

const kicked = new Map<string, Map<string, number>>()

export function recordKicked(slug: string, identity: string): void {
  let room = kicked.get(slug)
  if (!room) {
    room = new Map()
    kicked.set(slug, room)
  }
  room.set(identity, Date.now())
}

export function isKicked(slug: string, identity: string): boolean {
  const room = kicked.get(slug)
  if (!room) return false
  const at = room.get(identity)
  if (at === undefined) return false
  if (Date.now() - at > TTL_MS) {
    room.delete(identity)
    if (room.size === 0) kicked.delete(slug)
    return false
  }
  return true
}
