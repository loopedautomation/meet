/**
 * The organiser's proof, stashed by the browser that created the meeting.
 * Host-gated API routes want it presented explicitly — being the host in the
 * UI is a claim, this is the evidence.
 */
export function readHostKey(slug: string): string | null {
  try {
    return localStorage.getItem(`hostKey:${slug}`)
  } catch {
    return null
  }
}
