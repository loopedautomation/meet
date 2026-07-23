import { randomBytes } from "node:crypto"
import { lookup as lookupCb } from "node:dns"
import { lookup } from "node:dns/promises"
import { readFileSync, writeFileSync } from "node:fs"
import { isIP } from "node:net"

// Ad-hoc agents invited by URL (no agent-registry.yaml entry). Specs are persisted to
// a file rather than process memory because the control API (index.ts) and
// the LiveKit job processes (worker.ts) are separate processes in the same
// container — dispatch metadata carries only the generated id, never the
// token.
//
// The bridge refuses to dial private, loopback, link-local, and
// metadata-service destinations (see assertPublicAgentUrl) so a pasted URL
// can't be used to probe the deployment's internal network. Self-hosted
// setups that legitimately run agents on private addresses can opt out with
// DYNAMIC_AGENTS_ALLOW_PRIVATE=1.

const FILE = process.env.DYNAMIC_AGENTS_FILE ?? "/tmp/dynamic-agents.json"
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export { AGENT_VOICES } from "@meet/shared"

export type DynamicAgentSpec = {
  url: string
  token: string
  name: string
  description?: string
  voice?: string
}

type Stored = DynamicAgentSpec & { at: number }

function load(): Record<string, Stored> {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"))
  } catch {
    return {}
  }
}

export function registerDynamicAgent(spec: DynamicAgentSpec): string {
  const id = `dyn-${randomBytes(4).toString("hex")}`
  const all = load()
  const now = Date.now()
  for (const [key, value] of Object.entries(all)) {
    if (now - value.at > MAX_AGE_MS) delete all[key]
  }
  all[id] = { ...spec, at: now }
  writeFileSync(FILE, JSON.stringify(all), { mode: 0o600 })
  return id
}

export function getDynamicAgent(id: string): DynamicAgentSpec | null {
  return load()[id] ?? null
}

/**
 * Turn whatever a person pastes into a dialable TTY websocket URL, or null
 * if it can't be one. Bare domains get wss:// and the conventional /tty
 * path; http(s) schemes are mapped to their websocket equivalents.
 */
export function normalizeAgentUrl(input: string): string | null {
  let raw = input.trim()
  if (!raw) return null
  if (!/^[a-z]+:\/\//i.test(raw)) raw = `wss://${raw}`
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol === "https:") parsed.protocol = "wss:"
  if (parsed.protocol === "http:") parsed.protocol = "ws:"
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return null
  if (parsed.pathname === "" || parsed.pathname === "/") {
    parsed.pathname = "/tty"
  }
  return parsed.toString()
}

/** RFC1918/4193, loopback, link-local, unspecified, and cloud metadata. */
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
 * SSRF guard for pasted agent URLs: resolve the host and refuse anything
 * that lands on an internal address, so the bridge can't be pointed at the
 * deployment's own services. Returns an error message or null when the
 * destination is acceptable. (Resolution happens again at connect time — a
 * DNS-rebinding TOCTOU remains; an egress firewall is the real boundary.)
 */
export async function assertPublicAgentUrl(
  url: string,
): Promise<string | null> {
  if (process.env.DYNAMIC_AGENTS_ALLOW_PRIVATE === "1") return null
  let host: string
  try {
    host = new URL(url).hostname
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

/**
 * A DNS lookup that refuses private addresses at the moment of connection —
 * closing the rebinding window where a host resolves publicly during
 * validation and internally when the worker actually dials. Passed to the
 * `ws` client for dynamic (pasted-URL) agents.
 */
// biome-ignore lint/suspicious/noExplicitAny: matches node's LookupFunction callback shape
export function publicOnlyLookup(
  hostname: string,
  options: any,
  callback: any,
): void {
  lookupCb(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err)
    const list = Array.isArray(addresses) ? addresses : []
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return callback(new Error("refusing to connect to an internal address"))
    }
    if (options?.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

/** Whether dynamic-agent connections must stay on public addresses. */
export function dynamicAgentsPublicOnly(): boolean {
  return process.env.DYNAMIC_AGENTS_ALLOW_PRIVATE !== "1"
}

export type ProbedAgent = { name: string; description?: string }

/**
 * Validate a pasted agent URL by performing the TTY handshake: connect with
 * the bearer subprotocol and wait for the `hello` frame, which carries the
 * agent's own name and description (falling back to `handle` for agents on a
 * framework version that predates those fields).
 */
export async function probeAgent(
  url: string,
  token: string,
): Promise<ProbedAgent | { error: string }> {
  return new Promise((resolve) => {
    let settled = false
    const done = (result: ProbedAgent | { error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {}
      resolve(result)
    }
    const timer = setTimeout(
      () => done({ error: "agent did not respond (timeout)" }),
      5000,
    )
    let ws: WebSocket
    try {
      ws = new WebSocket(url, token ? [`bearer.${token}`] : [])
    } catch (err) {
      clearTimeout(timer)
      return resolve({ error: (err as Error).message })
    }
    ws.onmessage = (raw) => {
      try {
        const frame = JSON.parse(String(raw.data)) as {
          type?: string
          handle?: string
          name?: string
          description?: string
        }
        if (frame.type === "hello") {
          const description = frame.description?.trim()
          done({
            name: frame.name?.trim() || frame.handle || "Agent",
            ...(description ? { description } : {}),
          })
        }
      } catch {}
    }
    ws.onerror = () =>
      done({ error: "could not connect (check url and token)" })
    ws.onclose = (ev) =>
      done({
        error:
          ev.code === 1008 || ev.code === 4401
            ? "agent rejected the token"
            : "connection closed before handshake",
      })
  })
}
