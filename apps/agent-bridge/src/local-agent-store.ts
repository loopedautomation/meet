import { randomBytes } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

const FILE = process.env.LOCAL_AGENTS_FILE ?? "/tmp/local-agents.json"

export type LocalAgentSpec = {
  agentId: string
  room: string
  userId: string
  userName: string
  relayToken: string
  resumeToken: string
  hello?: unknown
  createdAt: number
  // Dial target for the worker — loopback relay
  url: string
}

type Stored = LocalAgentSpec & { at: number }

function load(): Record<string, Stored> {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"))
  } catch {
    return {}
  }
}

function save(all: Record<string, Stored>): void {
  writeFileSync(FILE, JSON.stringify(all), { mode: 0o600 })
}

export function registerLocalAgent(spec: LocalAgentSpec): void {
  const all = load()
  all[spec.agentId] = { ...spec, at: Date.now() }
  // prune older than 4h
  const cutoff = Date.now() - 4 * 60 * 60 * 1000
  for (const [k, v] of Object.entries(all)) {
    if (v.at < cutoff) delete all[k]
  }
  save(all)
}

export function getLocalAgent(agentId: string): LocalAgentSpec | null {
  return load()[agentId] ?? null
}

export function removeLocalAgent(agentId: string): void {
  const all = load()
  if (all[agentId]) {
    delete all[agentId]
    save(all)
  }
}

/** Generate a fresh local agent id. */
export function newLocalAgentId(): string {
  return `local-${randomBytes(4).toString("hex")}`
}

/** Generate secrets. */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString("hex")
}
