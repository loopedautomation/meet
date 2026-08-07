import { eq, getDb, schema, uuidv7 } from "@meet/db"
import { bridgeFetch } from "./bridge"
import type { Channel } from "./channels"
import { bridgeAgentBody } from "./externalAgents"

/**
 * The text half of "agents are members": when a message lands in a channel
 * an agent belongs to, the agent's brain gets a turn over the bridge's TTY
 * transport and its reply is persisted like any other message. In a DM with
 * an agent every message is addressed to it; in shared channels it answers
 * when @mentioned by name or id. Fire-and-forget from the message route —
 * the poll surfaces the reply, and a failed turn costs one reply, never the
 * member's own send.
 */
export async function respondAsAgents(
  channel: Channel,
  text: string,
  fromName: string,
): Promise<void> {
  try {
    const db = getDb()
    const assigned = await db
      .select({ agentId: schema.channelAgents.agentId })
      .from(schema.channelAgents)
      .where(eq(schema.channelAgents.channelId, channel.id))
    if (assigned.length === 0) return

    let responders = assigned.map((a) => a.agentId)
    if (!channel.isDm) {
      // Shared channels: only @mentioned agents answer. Names come from the
      // server-agent snapshot, ids always work.
      const invited = await db.select().from(schema.serverAgents)
      const nameById = new Map(invited.map((a) => [a.agentId, a.name]))
      const lower = text.toLowerCase()
      responders = responders.filter((id) => {
        const name = nameById.get(id)
        return (
          lower.includes(`@${id.toLowerCase()}`) ||
          (name ? lower.includes(`@${name.toLowerCase()}`) : false)
        )
      })
    }
    await Promise.allSettled(
      responders.map(async (agentId) => {
        const res = await bridgeFetch(`/agents/${agentId}/text`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // External ("ext-…") agents carry their decrypted dial spec along
          // — the bridge's dynamic store is only a cache of the database.
          body: JSON.stringify(
            await bridgeAgentBody(agentId, {
              conversationId: channel.publicId,
              text: `${fromName}: ${text}`,
            }),
          ),
          signal: AbortSignal.timeout(120_000),
        })
        if (!res.ok) return
        const data = (await res.json()) as { reply?: string }
        const reply = data.reply?.trim()
        if (!reply) return
        await db.insert(schema.messages).values({
          id: uuidv7(),
          channelId: channel.id,
          authorKind: "agent",
          authorAgentId: agentId,
          content: reply.slice(0, 8000),
        })
      }),
    )
  } catch (err) {
    console.error("agent text reply failed", err)
  }
}
