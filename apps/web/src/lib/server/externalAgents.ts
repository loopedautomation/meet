import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"
import { eq, getDb, schema } from "@meet/db"
import { bridgeFetch } from "./bridge"

// External (looped-af) agents registered with this server: their TTY bearer
// tokens are encrypted at rest with AES-256-GCM under AGENT_TOKEN_ENC_KEY (a
// 32-byte base64 key, e.g. `openssl rand -base64 32`). Registration tokens
// ("lreg_<32hex>") are stored only as sha256 hashes, like desktop sessions.

const CIPHERTEXT_VERSION = "v1"

function encryptionKey(): Buffer {
  const raw = process.env.AGENT_TOKEN_ENC_KEY
  if (!raw) {
    throw new Error(
      "AGENT_TOKEN_ENC_KEY is not set — generate one with: openssl rand -base64 32",
    )
  }
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) {
    throw new Error("AGENT_TOKEN_ENC_KEY must be 32 bytes of base64")
  }
  return key
}

/** AES-256-GCM; "v1:<iv b64>:<tag b64>:<data b64>". */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    CIPHERTEXT_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    data.toString("base64"),
  ].join(":")
}

export function decryptToken(ciphertext: string): string {
  const [version, iv, tag, data] = ciphertext.split(":")
  if (version !== CIPHERTEXT_VERSION || !iv || !tag || !data) {
    throw new Error("unrecognized token ciphertext format")
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64"),
  )
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** A fresh registration token — shown to the admin exactly once. */
export function generateRegistrationToken(): string {
  return `lreg_${randomBytes(16).toString("hex")}`
}

/** A fresh external-agent id, stable for the row's lifetime. */
export function generateExternalAgentId(): string {
  return `ext-${randomBytes(4).toString("hex")}`
}

export type ProbeResult =
  | { ok: true; url: string; name: string; description?: string }
  | { ok: false; status: number; error: string }

/**
 * Validate an agent URL/token through the bridge's probe endpoint — the web
 * tier never dials agent URLs itself (the SSRF policy and TTY handshake live
 * on the bridge). Returns the normalized URL and the agent's hello identity.
 */
export async function probeExternalAgent(
  url: string,
  token: string,
): Promise<ProbeResult> {
  try {
    const res = await bridgeFetch("/agents/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, token }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json()) as {
      url?: string
      name?: string
      description?: string
      error?: string
    }
    if (!res.ok || !data.url || !data.name) {
      return {
        ok: false,
        status: res.status === 422 ? 422 : 502,
        error: data.error ?? "probe failed",
      }
    }
    return {
      ok: true,
      url: data.url,
      name: data.name,
      ...(data.description ? { description: data.description } : {}),
    }
  } catch {
    return { ok: false, status: 502, error: "bridge unavailable" }
  }
}

export type ExternalAgentSpec = {
  url: string
  token: string
  name: string
  description?: string
  voice?: string
}

/** The decrypted dial spec for an external agent, threaded to the bridge
 * alongside dispatch/text requests. Null when the id isn't an external
 * agent's. */
export async function getExternalAgentSpec(
  agentId: string,
): Promise<ExternalAgentSpec | null> {
  if (!agentId.startsWith("ext-")) return null
  const row = await getDb().query.externalAgents.findFirst({
    where: eq(schema.externalAgents.id, agentId),
  })
  if (!row) return null
  return {
    url: row.url,
    token: decryptToken(row.tokenCiphertext),
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    ...(row.voice ? { voice: row.voice } : {}),
  }
}
