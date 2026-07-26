// Validates the PRODUCTION Gemini manual-turn gate (gemini-gate.ts, the
// exact module realtime-agent wires to the live session). The invariant:
// the model only ever hears — and can only answer — a turn delivered via
// sendBufferedTurn/notifyChatTurn. If the gate never calls those, a gated
// agent is structurally silent.
import {
  decideTurn,
  spokenMentionRegExp,
  type TurnPolicy,
  zapActive,
} from "@meet/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createGeminiGate, type GeminiGateDeps } from "./gemini-gate.js"

const harness = (policy: TurnPolicy) => {
  const state = { policy, zappedUntil: 0, gateOpen: false }
  let now = 1_000_000
  let deliberateVerdict: "pass" | "raise-hand" = "pass"
  const deps = {
    gateOpen: () => state.gateOpen,
    mention: spokenMentionRegExp("Scout"),
    decide: (mentioned: boolean) =>
      decideTurn({
        policy: state.policy,
        channel: "voice",
        mentioned,
        zapped: zapActive(state.zappedUntil, now),
        callOnPending: false,
        muted: false,
        deafened: false,
      }),
    sendBufferedTurn: vi.fn(() => true),
    notifyChatTurn: vi.fn(),
    notifyHeard: vi.fn(),
    deliberate: vi.fn(() => Promise.resolve(deliberateVerdict)),
    onHandRaise: vi.fn(),
    onDeliberateDone: vi.fn(),
    now: () => now,
  } satisfies GeminiGateDeps
  const gate = createGeminiGate(deps)
  return {
    gate,
    deps,
    state,
    tick: (ms: number) => {
      now += ms
    },
    setVerdict: (v: "pass" | "raise-hand") => {
      deliberateVerdict = v
    },
    /** Everything that could make the model produce audio for this turn. */
    audioPaths: () =>
      deps.sendBufferedTurn.mock.calls.length +
      deps.notifyChatTurn.mock.calls.length,
  }
}

describe("Gemini manual-turn gate", () => {
  let h: ReturnType<typeof harness>

  describe("on-mention", () => {
    beforeEach(() => {
      h = harness("on-mention")
    })

    it("unaddressed final: audio NEVER reaches the model — context + deliberation only", async () => {
      h.gate.onUtterance("user-1", "Sam", "let's talk about the roadmap", true)
      expect(h.audioPaths()).toBe(0)
      expect(h.deps.notifyHeard).toHaveBeenCalledOnce()
      expect(h.deps.deliberate).toHaveBeenCalledOnce()
      await Promise.resolve()
      expect(h.deps.onHandRaise).not.toHaveBeenCalled()
      expect(h.deps.onDeliberateDone).toHaveBeenCalledOnce()
    })

    it("a mention replays the buffered turn to the model", () => {
      h.gate.onUtterance("user-1", "Sam", "Scout, what do you think?", true)
      expect(h.deps.sendBufferedTurn).toHaveBeenCalledOnce()
      expect(h.deps.notifyHeard).not.toHaveBeenCalled()
    })

    it("empty ring falls back to the transcript as the turn", () => {
      h.deps.sendBufferedTurn.mockReturnValueOnce(false)
      h.gate.onUtterance("user-1", "Sam", "Scout, you there?", true)
      expect(h.deps.notifyChatTurn).toHaveBeenCalledWith(
        'Sam said to you: "Scout, you there?"',
      )
    })

    it("early path: interim mention arms, end-of-speech fires once, final deduped", () => {
      h.gate.onUtterance("user-1", "Sam", "hey Scout can you", false)
      h.gate.onEndOfSpeech()
      expect(h.deps.sendBufferedTurn).toHaveBeenCalledOnce()
      h.tick(1_000)
      h.gate.onUtterance("user-1", "Sam", "Hey Scout, can you check staging?", true)
      expect(h.audioPaths()).toBe(1) // deduped, not answered twice
    })

    it("agent identities never grant the floor", () => {
      h.gate.onUtterance("agent-other", "Echo", "Scout, your thoughts?", true)
      expect(h.audioPaths()).toBe(0)
      expect(h.deps.deliberate).not.toHaveBeenCalled()
    })

    it("end-of-speech without an armed mention sends nothing while gated", () => {
      h.gate.onEndOfSpeech()
      expect(h.audioPaths()).toBe(0)
    })

    it("a deliberation verdict of raise-hand raises the hand", async () => {
      h.setVerdict("raise-hand")
      h.gate.onUtterance("user-1", "Sam", "someone should check the logs", true)
      await Promise.resolve()
      expect(h.deps.onHandRaise).toHaveBeenCalledOnce()
    })
  })

  describe("raise-hand", () => {
    beforeEach(() => {
      h = harness("raise-hand")
    })

    it("a direct mention raises the hand — audio is impossible", () => {
      h.gate.onUtterance("user-1", "Sam", "Scout, what do you think?", true)
      expect(h.audioPaths()).toBe(0)
      expect(h.deps.onHandRaise).toHaveBeenCalledOnce()
    })

    it("the interim early path cannot arm either", () => {
      h.gate.onUtterance("user-1", "Sam", "hey Scout can you", false)
      h.gate.onEndOfSpeech()
      expect(h.audioPaths()).toBe(0)
    })

    it("zap grants the buffered turn (one-shot handled by the caller)", () => {
      h.state.zappedUntil = 1_000_000 + 30_000
      h.gate.onUtterance("user-1", "Sam", "so, any thoughts?", true)
      expect(h.deps.sendBufferedTurn).toHaveBeenCalledOnce()
    })

    it("expired zap grants nothing", () => {
      h.state.zappedUntil = 1_000_000 + 30_000
      h.tick(30_001)
      h.gate.onUtterance("user-1", "Sam", "so, any thoughts?", true)
      expect(h.audioPaths()).toBe(0)
    })
  })

  it("gate lifted (open policy / zap window): end-of-speech flushes every turn", () => {
    h = harness("open")
    h.state.gateOpen = true
    h.gate.onEndOfSpeech()
    expect(h.deps.sendBufferedTurn).toHaveBeenCalledOnce()
    // Utterance handling is the transcriber's job only while gated.
    h.gate.onUtterance("user-1", "Sam", "anything at all", true)
    expect(h.deps.deliberate).not.toHaveBeenCalled()
  })
})
