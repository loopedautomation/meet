import { customAlphabet } from "nanoid"

const adjectives = [
  "amber",
  "bright",
  "calm",
  "clever",
  "cosmic",
  "gentle",
  "golden",
  "keen",
  "lively",
  "lucid",
  "mellow",
  "nimble",
  "quiet",
  "rapid",
  "silver",
  "sunny",
  "swift",
  "tidy",
  "vivid",
  "witty",
]

const nouns = [
  "aurora",
  "beacon",
  "canyon",
  "comet",
  "delta",
  "ember",
  "falcon",
  "garden",
  "harbor",
  "island",
  "lagoon",
  "meadow",
  "nebula",
  "orbit",
  "prairie",
  "river",
  "summit",
  "tundra",
  "valley",
  "zephyr",
]

const suffix = customAlphabet("abcdefghjkmnpqrstuvwxyz23456789", 4)

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function generateRoomSlug(): string {
  return `${pick(adjectives)}-${pick(nouns)}-${suffix()}`
}

export function isValidRoomSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+){1,3}$/.test(slug) && slug.length <= 64
}
