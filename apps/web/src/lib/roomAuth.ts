/**
 * The caller's own LiveKit token as an Authorization header for room-scoped
 * API routes (doc, admit, agent invites). The server verifies the signature
 * and derives the caller's identity from it — never from the request body.
 */
export function roomAuthHeaders(slug: string): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(`rejoin:${slug}`)
    const token = raw
      ? ((JSON.parse(raw) as { rejoinToken?: string }).rejoinToken ?? null)
      : null
    return token ? { authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}
