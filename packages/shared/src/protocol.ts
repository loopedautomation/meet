/**
 * Server ↔ desktop-client compatibility handshake.
 *
 * The desktop shell is distributed separately from the server it talks to:
 * users update the app on their own schedule, self-hosters update the server
 * on theirs. Any pair can therefore meet, including pairs that were never
 * tested together. This module defines the contract that lets each side
 * detect an incompatible peer at connect time — with an actionable message —
 * instead of failing later as a 404 on a route the peer doesn't have.
 *
 * ## Versioning
 *
 * `PROTOCOL_VERSION` is a single integer covering the whole client-facing
 * contract: the desktop auth exchange, the session cookie semantics, and the
 * JSON shapes behind the routes the shell calls. It is deliberately NOT the
 * package version — most releases change neither side's expectations, and
 * bumping on every release would force upgrades nobody needs.
 *
 * Bump it when a change would break a peer that hasn't been updated:
 *   - removing or renaming a route/field the shell relies on
 *   - changing the meaning of an existing field
 *   - changing how the desktop session is established or presented
 *
 * Additive, ignorable changes (a new optional field, a new route older
 * clients never call) do NOT need a bump — that's the point of the integer.
 *
 * ## Windows, not equality
 *
 * Each side advertises what it speaks and the oldest peer it still supports,
 * so support windows can be widened or narrowed without lockstep releases.
 * A server that drops support for ancient clients raises
 * `MIN_CLIENT_PROTOCOL`; the clients it rejects get told to update, rather
 * than silently misbehaving.
 */

/**
 * Identifies the response as a looped meet server. `/api/health` previously
 * returned a bare `{ok: true}`, which any 200 on any host satisfies — a typo'd
 * hostname pointing at an unrelated service would be accepted as a valid
 * server. Clients match this marker before trusting anything else in the body.
 */
export const SERVICE_ID = "looped-meet"

/** The protocol this build of the server/web app speaks. */
export const PROTOCOL_VERSION = 1

/**
 * Oldest client protocol this server still serves. Equal to
 * `PROTOCOL_VERSION` today because v1 is the first — there is nothing older
 * to support. Raise it only when carrying a compatibility shim for old
 * clients becomes more expensive than forcing an app update.
 */
export const MIN_CLIENT_PROTOCOL = 1

/** Shape of the `/api/health` handshake response. */
export interface HandshakeResponse {
  ok: boolean
  /** Always `SERVICE_ID` — the "this is really a meet server" marker. */
  service: string
  /** Protocol the server speaks. */
  protocol: number
  /** Oldest client protocol the server will serve. */
  minClientProtocol: number
  /** Human-facing build version, for support and diagnostics only. */
  version: string
}

export type CompatibilityResult =
  /** Peer is a meet server speaking a protocol we can talk. */
  | { ok: true; server: HandshakeResponse }
  /** Reachable, but not a meet server (or too old to identify itself). */
  | { ok: false; reason: "not-a-meet-server" }
  /** Server is newer than us; the app needs updating. */
  | { ok: false; reason: "client-too-old"; server: HandshakeResponse }
  /** Server is older than we support; it needs upgrading. */
  | { ok: false; reason: "server-too-old"; server: HandshakeResponse }

/**
 * Validate a parsed `/api/health` body against what this client speaks.
 * Pure and side-effect free so both sides — and tests — can share it.
 *
 * @param body           Parsed JSON from `/api/health`, untrusted.
 * @param clientProtocol Protocol the calling client speaks.
 * @param minServerProtocol Oldest server protocol the client supports.
 */
export function checkCompatibility(
  body: unknown,
  clientProtocol: number,
  minServerProtocol: number,
): CompatibilityResult {
  const server = body as Partial<HandshakeResponse> | null

  // Anything that doesn't identify itself is treated as "not a meet server",
  // including a genuine pre-handshake server: from the client's side the two
  // are indistinguishable, and both mean "don't proceed".
  if (
    !server ||
    typeof server !== "object" ||
    server.service !== SERVICE_ID ||
    typeof server.protocol !== "number" ||
    typeof server.minClientProtocol !== "number"
  ) {
    return { ok: false, reason: "not-a-meet-server" }
  }

  const full = {
    ok: server.ok !== false,
    service: server.service,
    protocol: server.protocol,
    minClientProtocol: server.minClientProtocol,
    version: typeof server.version === "string" ? server.version : "unknown",
  }

  // Checked before "server too old": when the windows don't overlap at all,
  // the client is the side the user can actually fix.
  if (clientProtocol < full.minClientProtocol) {
    return { ok: false, reason: "client-too-old", server: full }
  }
  if (full.protocol < minServerProtocol) {
    return { ok: false, reason: "server-too-old", server: full }
  }
  return { ok: true, server: full }
}
