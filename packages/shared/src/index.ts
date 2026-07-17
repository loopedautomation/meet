import { z } from "zod"

/** Data-channel topics used across web and agent-bridge. */
export const DataTopic = {
  AgentActivity: "agent-activity",
  AgentControl: "agent-control",
  Chat: "chat",
} as const

/** LiveKit's built-in transcription text-stream topic. */
export const TRANSCRIPTION_TOPIC = "lk.transcription"

/** Participant attribute key holding an agent's conversational state. */
export const AGENT_STATE_ATTRIBUTE = "agent.state"

export const agentStateSchema = z.enum([
  "listening",
  "thinking",
  "speaking",
  "muted",
  "deafened",
])
export type AgentState = z.infer<typeof agentStateSchema>

export const participantMetaSchema = z.object({
  // "service" participants (e.g. the platform transcriber) are invisible
  // infrastructure: no tile, no chimes, no mention picker entry. "waiting"
  // participants have knocked and sit in the waiting room until admitted.
  kind: z.enum(["human", "agent", "service", "waiting"]),
  agentId: z.string().optional(),
  service: z.string().optional(),
})
export type ParticipantMeta = z.infer<typeof participantMetaSchema>

export function parseParticipantMeta(
  raw: string | undefined,
): ParticipantMeta | null {
  if (!raw) return null
  try {
    return participantMetaSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Voices an agent may speak with (realtime model voices). */
export const AGENT_VOICES = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "coral",
  "sage",
  "verse",
] as const
export type AgentVoice = (typeof AGENT_VOICES)[number]

/** True for infrastructure participants that the UI should not render. */
export function isServiceParticipant(metadata: string | undefined): boolean {
  return parseParticipantMeta(metadata)?.kind === "service"
}

/** Control messages published by participants on the `agent-control` topic. */
export const agentControlSchema = z.object({
  type: z.enum(["mute", "unmute", "deafen", "undeafen", "interrupt"]),
  agentId: z.string(),
})
export type AgentControl = z.infer<typeof agentControlSchema>

/** Events published by the bridge on the `agent-activity` data topic. */
export const agentActivityEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("step"),
    agentId: z.string(),
    n: z.number(),
    at: z.number(),
  }),
  z.object({
    type: z.literal("tool_call"),
    agentId: z.string(),
    name: z.string(),
    arguments: z.string(),
    at: z.number(),
  }),
  z.object({
    type: z.literal("tool_result"),
    agentId: z.string(),
    name: z.string(),
    content: z.string(),
    durationMs: z.number(),
    at: z.number(),
  }),
  z.object({
    type: z.literal("status"),
    agentId: z.string(),
    state: agentStateSchema,
    at: z.number(),
  }),
  // "Stats for nerds": the agent's pipeline configuration plus rolling
  // latency measurements, published by the bridge as they update.
  z.object({
    type: z.literal("stats"),
    agentId: z.string(),
    config: z.record(z.string(), z.string()),
    latencyMs: z.record(z.string(), z.number()),
    at: z.number(),
  }),
])
export type AgentActivityEvent = z.infer<typeof agentActivityEventSchema>
export type AgentStatsEvent = Extract<AgentActivityEvent, { type: "stats" }>

/** Messages on the `chat` data topic. */
export const chatMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  fromName: z.string(),
  text: z.string(),
  at: z.number(),
})
export type ChatMessage = z.infer<typeof chatMessageSchema>

/** API DTOs. */
export const createRoomResponseSchema = z.object({
  slug: z.string(),
  url: z.string(),
})
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>

export const tokenRequestSchema = z.object({
  displayName: z.string().min(1).max(64),
  /**
   * A previously issued token for this room, proving prior admission — a
   * page refresh re-enters directly instead of knocking again.
   */
  rejoinToken: z.string().optional(),
})
export type TokenRequest = z.infer<typeof tokenRequestSchema>

export const tokenResponseSchema = z.object({
  token: z.string(),
  serverUrl: z.string(),
  identity: z.string(),
  /** How many participants were already in the room before this join. */
  participantCount: z.number().int().min(0).default(0),
  /** True when the joiner enters the waiting room pending admission. */
  waiting: z.boolean().default(false),
})
export type TokenResponse = z.infer<typeof tokenResponseSchema>

export const agentInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  avatar: z.string().optional(),
})
export type AgentInfo = z.infer<typeof agentInfoSchema>
