import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/** RFC1918/4193, loopback, link-local (incl. cloud metadata), and CGNAT.
 * Trimmed copy of apps/agent-bridge/src/dynamic.ts's isPrivateAddress —
 * no shared package to import it from, and the two guards serve different
 * outbound-fetch call sites (agent dialing vs. link-preview fetching). */
function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number)
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) || // link-local, incl. 169.254.169.254 metadata
      (a === 100 && b >= 64 && b <= 127) // CGNAT
    )
  }
  const lower = ip.toLowerCase()
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80")
  )
}

/**
 * SSRF guard for outbound fetches to URLs pasted into chat: resolve the
 * host and refuse anything that lands on an internal address, so a chat
 * message can't be used to probe the deployment's own network. Returns an
 * error message, or null when the destination is acceptable. (Resolution
 * happens again at fetch time — a DNS-rebinding TOCTOU remains; an egress
 * firewall is the real boundary.)
 */
export async function assertPublicUrl(url: string): Promise<string | null> {
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "only http(s) urls are allowed"
    }
    host = parsed.hostname
  } catch {
    return "invalid url"
  }
  const bare = host.replace(/^\[|\]$/g, "")
  if (isIP(bare)) {
    return isPrivateAddress(bare) ? "internal addresses are not allowed" : null
  }
  try {
    const addrs = await lookup(bare, { all: true })
    if (addrs.length === 0) return "could not resolve host"
    if (addrs.some((a) => isPrivateAddress(a.address))) {
      return "internal addresses are not allowed"
    }
  } catch {
    return "could not resolve host"
  }
  return null
}
