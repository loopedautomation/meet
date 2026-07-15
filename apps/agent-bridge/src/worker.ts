import {
  defineAgent,
  type JobContext,
  type JobProcess,
  type JobRequest,
  voice,
} from "@livekit/agents"
import * as openai from "@livekit/agents-plugin-openai"
import * as silero from "@livekit/agents-plugin-silero"
import {
  AGENT_STATE_ATTRIBUTE,
  type AgentActivityEvent,
  type AgentState,
  agentControlSchema,
  type ChatMessage,
  chatMessageSchema,
  DataTopic,
  type ParticipantMeta,
} from "@meet/shared"
import { LoopedVoiceAgent, SessionState } from "./agent-session.js"
import { LoopedTtyClient } from "./looped-tty.js"
import { type Brain, LoopedWebhookClient } from "./looped-webhook.js"
import { type AgentEntry, brainToken, loadRegistry } from "./registry.js"

type DispatchMeta = { agentId: string }

function entryFromMetadata(metadata: string): AgentEntry {
  const { agentId } = JSON.parse(metadata) as DispatchMeta
  const entry = loadRegistry().find((a) => a.id === agentId)
  if (!entry) throw new Error(`unknown agent: ${agentId}`)
  return entry
}

/** Accept dispatches with an agent-scoped identity and metadata. */
export async function acceptRequest(request: JobRequest): Promise<void> {
  const entry = entryFromMetadata(request.job.metadata)
  const meta: ParticipantMeta = { kind: "agent", agentId: entry.id }
  await request.accept(entry.name, `agent-${entry.id}`, JSON.stringify(meta), {
    [AGENT_STATE_ATTRIBUTE]: "listening" satisfies AgentState,
  })
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load()
  },
  entry: async (ctx: JobContext) => {
    const entry = entryFromMetadata(ctx.job.metadata)
    const roomName = ctx.job.room?.name ?? "room"

    const brainOpts = {
      url: entry.brain.url,
      token: brainToken(entry),
      conversationId: `${roomName}-${entry.id}`,
    }
    const brain: Brain =
      entry.brain.kind === "tty"
        ? new LoopedTtyClient(brainOpts)
        : new LoopedWebhookClient(brainOpts)

    await ctx.connect()
    const local = ctx.room.localParticipant
    if (!local) throw new Error("no local participant after connect")

    const sessionState = new SessionState()

    const setState = (state: AgentState) => {
      local
        .setAttributes({ [AGENT_STATE_ATTRIBUTE]: state })
        .catch(() => undefined)
    }
    const publishActivity = (event: AgentActivityEvent) => {
      local
        .publishData(new TextEncoder().encode(JSON.stringify(event)), {
          reliable: true,
          topic: DataTopic.AgentActivity,
        })
        .catch(() => undefined)
    }
    const publishChat = (text: string) => {
      const message: ChatMessage = {
        id: `${entry.id}-${Date.now()}`,
        from: `agent-${entry.id}`,
        fromName: entry.name,
        text,
        at: Date.now(),
      }
      local
        .publishData(new TextEncoder().encode(JSON.stringify(message)), {
          reliable: true,
          topic: DataTopic.Chat,
        })
        .catch(() => undefined)
    }

    const agent = new LoopedVoiceAgent(entry, brain, sessionState, {
      publishActivity,
      publishChat,
      setState,
    })

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: new openai.STT({ model: entry.stt.model }),
      tts: new openai.TTS({
        model: entry.tts.model,
        voice: entry.tts.voice as openai.TTSVoices,
      }),
    })

    // Mirror the pipeline's state onto a participant attribute for the UI.
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (sessionState.muted) return
      const map: Record<string, AgentState> = {
        listening: "listening",
        thinking: "thinking",
        speaking: "speaking",
      }
      const mapped = map[ev.newState]
      if (mapped) setState(mapped)
    })

    // Mute/unmute controls and chat @-mentions arrive over data topics.
    ctx.room.on("dataReceived", (payload: Uint8Array, _p, _k, topic) => {
      if (topic === DataTopic.AgentControl) {
        try {
          const control = agentControlSchema.parse(
            JSON.parse(new TextDecoder().decode(payload)),
          )
          if (control.agentId !== entry.id) return
          if (control.type === "mute" && !sessionState.muted) {
            sessionState.muted = true
            sessionState.notifiedMuted = false
            session.interrupt()
            setState("muted")
          } else if (control.type === "unmute" && sessionState.muted) {
            sessionState.muted = false
            setState("listening")
          }
        } catch {
          // ignore malformed control messages
        }
      } else if (topic === DataTopic.Chat) {
        try {
          const message = chatMessageSchema.parse(
            JSON.parse(new TextDecoder().decode(payload)),
          )
          if (message.from === `agent-${entry.id}`) return
          const mention = new RegExp(`@${entry.name}\\b`, "i")
          if (!mention.test(message.text)) return
          session.generateReply({
            userInput: `${message.fromName} (in meeting chat): ${message.text}`,
          })
        } catch {
          // ignore malformed chat messages
        }
      }
    })

    await session.start({ agent, room: ctx.room })

    if (entry.greeting) {
      session.say(entry.greeting)
    }

    ctx.addShutdownCallback(async () => {
      brain.close()
    })
  },
})
