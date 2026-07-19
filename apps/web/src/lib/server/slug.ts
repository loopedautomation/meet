import { createHmac, timingSafeEqual } from "node:crypto"
import { customAlphabet } from "nanoid"

// Digits only: e.g. 4821035799.
const digits = customAlphabet("0123456789", 10)

function secret(): string {
  const s = process.env.MEET_ROOM_SECRET ?? process.env.LIVEKIT_API_SECRET
  if (!s) throw new Error("LIVEKIT_API_SECRET is required")
  return s
}

function sign(code: string): string {
  return createHmac("sha256", secret()).update(code).digest("hex").slice(0, 8)
}

/**
 * Meeting slugs are `<10 digits>-<8 hex hmac>`. The signature is what makes
 * links durable: a room that LiveKit has garbage-collected (5-min empty
 * timeout) is recreated on demand for a validly signed slug, while unsigned
 * guesses still cannot resurrect rooms and bypass the creation gate.
 */
export function generateRoomSlug(): string {
  const code = digits()
  return `${code}-${sign(code)}`
}

/** True when the slug carries a valid signature — safe to (re)create. */
export function isSignedRoomSlug(slug: string): boolean {
  const match = /^(\d{10})-([0-9a-f]{8})$/.exec(slug)
  if (!match) return false
  const given = Buffer.from(match[2])
  const expected = Buffer.from(sign(match[1]))
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * The creator's key, derived from the slug rather than stored — so the
 * host-start gate survives room garbage collection and recreation.
 */
export function deriveHostKey(slug: string): string {
  return createHmac("sha256", `${secret()}:host`).update(slug).digest("hex")
}

export function isValidRoomSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+){0,3}$/.test(slug) && slug.length <= 64
}
