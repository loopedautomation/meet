import { customAlphabet } from "nanoid"

// Digits only: e.g. 4821035799641102.
// 16 digits ≈ 10^16 combinations — unguessable at any realistic rate.
const digits = customAlphabet("0123456789", 16)

export function generateRoomSlug(): string {
  return digits()
}

export function isValidRoomSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+){0,3}$/.test(slug) && slug.length <= 64
}
