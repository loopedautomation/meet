import { rejoinToken } from "@/lib/rejoinStore"

/**
 * The caller's own LiveKit token as an Authorization header for room-scoped
 * API routes (doc, admit, agent invites). The server verifies the signature
 * and derives the caller's identity from it — never from the request body.
 *
 * Where the proof lives is lib/rejoinStore's business alone; reading storage
 * directly here is what let the reader and writer drift apart (#259).
 */
export function roomAuthHeaders(slug: string): Record<string, string> {
  const token = rejoinToken(slug)
  return token ? { authorization: `Bearer ${token}` } : {}
}
