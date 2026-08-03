import { LoopedTtyClient } from "./looped-tty.js"
import { type AgentEntry, brainToken } from "./registry.js"

/**
 * Room-less agent conversations: DMs and text channels talk to an agent's
 * brain over the same TTY transport the meeting worker uses, keyed by
 * conversation so the brain keeps continuity per channel. One client per
 * (agent, conversation), evicted after idling — the brain's own
 * conversation state lives with the brain, so eviction only costs a
 * reconnect.
 */

const IDLE_EVICT_MS = 30 * 60 * 1000

type CachedClient = {
  client: LoopedTtyClient
  lastUsed: number
}

const clients = new Map<string, CachedClient>()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of clients) {
    if (now - entry.lastUsed > IDLE_EVICT_MS) {
      entry.client.close?.()
      clients.delete(key)
    }
  }
}, 60_000).unref?.()

function clientFor(entry: AgentEntry, conversationId: string): LoopedTtyClient {
  if (entry.brain.kind !== "tty") {
    throw new Error(
      `agent "${entry.id}" has a ${entry.brain.kind} brain — text chat needs tty`,
    )
  }
  const key = `${entry.id}:${conversationId}`
  const cached = clients.get(key)
  if (cached) {
    cached.lastUsed = Date.now()
    return cached.client
  }
  const client = new LoopedTtyClient({
    url: entry.brain.url,
    token: brainToken(entry),
    // Namespaced so a text conversation never collides with a meeting's
    // transcript conversation for the same brain.
    conversationId: `meet-text-${conversationId}`,
    // Text chat is interactive; don't let one turn hold the lane for the
    // worker default of 10 minutes.
    turnTimeoutMs: 120_000,
  })
  clients.set(key, { client, lastUsed: Date.now() })
  return client
}

/**
 * Run one text turn and return the brain's reply. Serialized per
 * conversation by the client's own turn queue.
 */
export async function textTurn(
  entry: AgentEntry,
  conversationId: string,
  input: string,
): Promise<string> {
  const client = clientFor(entry, conversationId)
  const key = `${entry.id}:${conversationId}`
  const cached = clients.get(key)
  if (cached) cached.lastUsed = Date.now()
  let reply = ""
  for await (const frame of client.runTurn(input)) {
    if (frame.type === "result") reply = frame.reply
    else if (frame.type === "error") throw new Error(frame.error)
  }
  return reply
}
