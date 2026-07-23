import { parseParticipantMeta } from "@meet/shared"
import { TokenVerifier } from "livekit-server-sdk"
import { livekitEnv } from "@/lib/server/livekit"

/**
 * A caller's proven room membership: routes that act inside a meeting
 * (admit, doc, agent invites) authenticate with the caller's own LiveKit
 * token in `Authorization: Bearer …` and never trust identities named in
 * the request body.
 */
export type VerifiedParticipant = {
  identity: string
  name: string
  /** "human" (admitted) or "waiting" from the token's server-set metadata. */
  kind: "human" | "waiting"
}

/**
 * Cryptographically verifies the caller's LiveKit token for this room.
 * Returns the verified participant, or null when the header is missing, the
 * signature is bad, the token is expired, or it was minted for another room.
 *
 * The token's metadata is server-set at mint time (participants cannot forge
 * a "human" claim without the signing secret), so `kind` is trustworthy.
 */
export async function verifyParticipant(
  request: Request,
  slug: string,
): Promise<VerifiedParticipant | null> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : ""
  if (!token) return null
  const { apiKey, apiSecret } = livekitEnv()
  try {
    const claims = await new TokenVerifier(apiKey, apiSecret).verify(token)
    if (claims.video?.room !== slug) return null
    const kind = parseParticipantMeta(claims.metadata)?.kind
    if (kind !== "human" && kind !== "waiting") return null
    // ClaimGrants doesn't surface sub/name; decode them from the (already
    // signature-verified) payload.
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
    ) as { sub?: string; name?: string }
    if (!payload.sub) return null
    return { identity: payload.sub, name: payload.name ?? payload.sub, kind }
  } catch {
    return null
  }
}
