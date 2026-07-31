// Validates the PRODUCTION pipeline gating: LoopedVoiceAgent.llmNode wired
// to the shared decideTurn — not the decision function in isolation. A fake
// brain records whether the turn ever reached it; a null return with an
// untouched brain is the hard proof the agent cannot speak.
import type { ChatContext, llm, voice } from "@livekit/agents"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  type BridgeCallbacks,
  LoopedVoiceAgent,
  type MeetingContext,
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

  it("raise-hand: zap grants one turn, opens the engaged window, then re-gates", async () => {
    const { brain, runTurn } = fakeBrain()
    state.turnPolicy = "raise-hand"
    state.zappedUntil = Date.now() + 30_000
    const agent = agentWith(brain)
    const first = await run(agent, "so, any thoughts?")
    expect(first).not.toBeNull()
    expect(state.zappedUntil).toBe(0) // consumed
    // The zap was a direct address: follow-ups keep the floor for a while.
    expect(state.engagedUntil).toBeGreaterThan(Date.now())
    const followUp = await run(agent, "and another thing…")
    expect(followUp).not.toBeNull()
    // Once the window lapses, the agent is gated again.
    state.engagedUntil = 0
    const later = await run(agent, "unrelated chatter")
    expect(later).toBeNull()
    expect(runTurn).toHaveBeenCalledTimes(2)
  })

  it("on-mention: a mention opens the engaged window; follow-ups speak unnamed", async () => {
    const { brain, runTurn } = fakeBrain()
    state.turnPolicy = "on-mention"
    const agent = agentWith(brain)
    const first = await run(agent, "Scout, draw me a flowchart")
    expect(first).not.toBeNull()
    const followUp = await run(agent, "of how espresso is dialed in")
    expect(followUp).not.toBeNull()
    expect(runTurn).toHaveBeenCalledTimes(2)
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

// The pipeline's own STT merges every human speaker into one unattributed
// stream — without a per-turn speaker tag the brain can end up addressing
// whoever it last named instead of whoever is actually talking (issue #193).
describe("LoopedVoiceAgent.llmNode speaker attribution", () => {
  let state: SessionState
  let callbacks: ReturnType<typeof fakeCallbacks>

  beforeEach(() => {
    state = new SessionState()
    callbacks = fakeCallbacks()
  })

  const agentWith = (brain: Brain, meeting: MeetingContext | null) =>
    new LoopedVoiceAgent(entry, brain, state, callbacks, null, meeting)

  it("prefixes the turn with the last known speaker", async () => {
    const { brain, runTurn } = fakeBrain()
    const meeting: MeetingContext = {
      roster: () => "",
      lastSpeaker: () => "Amin",
    }
    await run(agentWith(brain, meeting), "what's the weather like?")
    expect(runTurn).toHaveBeenCalledWith(
      "Amin: what's the weather like?",
      undefined,
    )
  })

  it("leaves text unprefixed when no meeting context is given", async () => {
    const { brain, runTurn } = fakeBrain()
    await run(agentWith(brain, null), "what's the weather like?")
    expect(runTurn).toHaveBeenCalledWith("what's the weather like?", undefined)
  })

  it("leaves text unprefixed when the last speaker is unknown", async () => {
    const { brain, runTurn } = fakeBrain()
    const meeting: MeetingContext = {
      roster: () => "",
      lastSpeaker: () => null,
    }
    await run(agentWith(brain, meeting), "what's the weather like?")
    expect(runTurn).toHaveBeenCalledWith("what's the weather like?", undefined)
  })

  it("attributes to whoever spoke most recently, turn by turn", async () => {
    const { brain, runTurn } = fakeBrain()
    let speaker = "Amin"
    const meeting: MeetingContext = {
      roster: () => "",
      lastSpeaker: () => speaker,
    }
    const agent = agentWith(brain, meeting)
    await run(agent, "what's the weather like?")
    speaker = "Happy"
    await run(agent, "and what about tomorrow?")
    expect(runTurn).toHaveBeenNthCalledWith(
      1,
      "Amin: what's the weather like?",
      undefined,
    )
    expect(runTurn).toHaveBeenNthCalledWith(
      2,
      "Happy: and what about tomorrow?",
      undefined,
    )
  })
})
