import { readFileSync } from "node:fs"
import { parse } from "yaml"
import { z } from "zod"

const brainSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tty"),
    url: z.string(),
    token_env: z.string(),
  }),
  z.object({
    kind: z.literal("webhook"),
    url: z.string(),
    token_env: z.string(),
  }),
])

const agentEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string().optional(),
  avatar: z.string().optional(),
  greeting: z.string().optional(),
  brain: brainSchema,
  stt: z
    .object({
      provider: z.enum(["openai"]).default("openai"),
      model: z.string().default("gpt-4o-mini-transcribe"),
    })
    .default({ provider: "openai", model: "gpt-4o-mini-transcribe" }),
  tts: z
    .object({
      provider: z.enum(["openai"]).default("openai"),
      model: z.string().default("gpt-4o-mini-tts"),
      voice: z.string().default("alloy"),
    })
    .default({ provider: "openai", model: "gpt-4o-mini-tts", voice: "alloy" }),
})

const registrySchema = z.object({
  agents: z.array(agentEntrySchema),
})

export type AgentEntry = z.infer<typeof agentEntrySchema>

export function loadRegistry(
  path = process.env.AGENTS_CONFIG ?? "agents.yaml",
): AgentEntry[] {
  const raw = parse(readFileSync(path, "utf8"))
  return registrySchema.parse(raw).agents
}

export function brainToken(entry: AgentEntry): string {
  const token = process.env[entry.brain.token_env]
  if (!token) {
    throw new Error(
      `Agent "${entry.id}": env var ${entry.brain.token_env} is not set`,
    )
  }
  return token
}
