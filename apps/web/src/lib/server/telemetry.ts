import { createHash } from "node:crypto"

/**
 * Whether anonymous usage telemetry should run. The key is baked into the
 * published image at build time; TELEMETRY_DISABLED=1 is read at request
 * time so self-hosters can opt out without rebuilding.
 */
export function telemetryEnabled(): boolean {
  return (
    process.env.TELEMETRY_DISABLED !== "1" &&
    !!process.env.NEXT_PUBLIC_POSTHOG_KEY
  )
}

/**
 * A stable anonymous deployment identifier, derived (not stored) from the
 * same secret chain as room slugs — no volume needed, and the secret itself
 * is never recoverable from the hash.
 */
export function instanceId(): string {
  const secret = process.env.MEET_ROOM_SECRET ?? process.env.LIVEKIT_API_SECRET
  if (!secret) return "unknown"
  return createHash("sha256")
    .update(`meet-instance:${secret}`)
    .digest("hex")
    .slice(0, 16)
}
