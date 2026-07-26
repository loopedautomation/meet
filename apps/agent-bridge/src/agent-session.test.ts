// Validates the PRODUCTION pipeline gating: LoopedVoiceAgent.llmNode wired
// to the shared decideTurn — not the decision function in isolation. A fake
// brain records whether the turn ever reached it; a null return with an
// untouched brain is the hard proof the agent cannot speak.
import type { ChatContext, llm, voice } from "@livekit/agents"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  type BridgeCallbacks,
  LoopedVoiceAgent,
  SessionState,
} from "./agent-session.js"
import type { Brain } from "./looped-webhook.js"
import type { AgentEntry } from "./registry.js"

const entry = { id: "scout", name: "Scout" } as AgentEntry

function fakeBrain() {
  const runTurn = vi.fn(async function* () {
    yield { type: "result", reply: "hello from the brain" }
  })
  return { brain: { runTurn } as unknown as Brain, runTurn }
}

function fakeCallbacks() {
  return {
    publishActivity: vi.fn(),
    publishChat: vi.fn(),
    setState: vi.fn(),
  } satisfies BridgeCallbacks
}

const ctxWith = (text: string) =>
  ({
    items: [{ type: "message", role: "user", textContent: text }],
  }) as unknown as ChatContext

const run = (
  agent: LoopedVoiceAgent,
  text: string,
): Promise<ReadableStream<string> | null> =>
  agent.llmNode(
    ctxWith(text),
    {} as llm.ToolContext,
    {} as voice.ModelSettings,
  ) as Promise<ReadableStream<string> | null>

describe("LoopedVoiceAgent.llmNode gating", () => {
  let state: SessionState
  let callbacks: ReturnType<typeof fakeCallbacks>

  beforeEach(() => {
    state = new SessionState()
    callbacks = fakeCallbacks()
  })

  const agentWith = (brain: Brain) =>
    new LoopedVoiceAgent(entry, brain, state, callbacks)

  it("open: every turn reaches the brain", async () => {
    const { brain, runTurn } = fakeBrain()
    const stream = await run(agentWith(brain), "totally unrelated chatter")
    expect(stream).not.toBeNull()
    expect(runTurn).toHaveBeenCalledOnce()
  })

  it("on-mention: unmentioned turn NEVER reaches the brain", async () => {
    const { brain, runTurn } = fakeBrain()
    state.turnPolicy = "on-mention"
    const stream = await run(agentWith(brain), "let's discuss the roadmap")
    expect(stream).toBeNull()
    expect(runTurn).not.toHaveBeenCalled()
  })

  it("on-mention: a mention grants the floor", async () => {
    const { brain, runTurn } = fakeBrain()
    state.turnPolicy = "on-mention"
    const stream = await run(agentWith(brain), "Scout, what do you think?")
    expect(stream).not.toBeNull()
    expect(runTurn).toHaveBeenCalledOnce()
  })

  it("raise-hand: even a direct mention cannot speak — hand goes up", async () => {
    const { brain, runTurn } = fakeBrain()
    state.turnPolicy = "raise-hand"
    const stream = await run(agentWith(brain), "Scout, what do you think?")
    expect(stream).toBeNull()
    expect(runTurn).not.toHaveBeenCalled()
    expect(callbacks.setState).toHaveBeenCalledWith("hand-raised")
  })

  it("raise-hand: zap grants exactly one turn, then re-gates", async () => {
    const { brain, runTurn } = fakeBrain()
    state.turnPolicy = "raise-hand"
    state.zappedUntil = Date.now() + 30_000
    const agent = agentWith(brain)
    const first = await run(agent, "so, any thoughts?")
    expect(first).not.toBeNull()
    expect(state.zappedUntil).toBe(0) // consumed
    const second = await run(agent, "and another thing…")
    expect(second).toBeNull()
    expect(runTurn).toHaveBeenCalledOnce()
  })

  it("expired zap grants nothing", async () => {
    const { brain, runTurn } = fakeBrain()
    state.turnPolicy = "on-mention"
    state.zappedUntil = Date.now() - 1
    const stream = await run(agentWith(brain), "unaddressed turn")
    expect(stream).toBeNull()
    expect(runTurn).not.toHaveBeenCalled()
  })

  it("call-on grants the floor and is consumed", async () => {
    const { brain, runTurn } = fakeBrain()
    state.turnPolicy = "raise-hand"
    state.callOnPending = true
    const stream = await run(agentWith(brain), "go ahead")
    expect(stream).not.toBeNull()
    expect(state.callOnPending).toBe(false)
    expect(runTurn).toHaveBeenCalledOnce()
  })

  it("deafened: turns are ignored on every policy", async () => {
    const { brain, runTurn } = fakeBrain()
    state.deafened = true
    for (const policy of ["open", "on-mention", "raise-hand"] as const) {
      state.turnPolicy = policy
      expect(await run(agentWith(brain), "Scout, hello?")).toBeNull()
    }
    expect(runTurn).not.toHaveBeenCalled()
  })
})
