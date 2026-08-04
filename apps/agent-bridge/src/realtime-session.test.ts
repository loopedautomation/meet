// Validates the PRODUCTION OpenAI realtime gating at the wire level: a fake
// WebSocket captures every frame the session sends, and synthetic server
// events drive RealtimeSession.#handle. The invariant under test: with the
// gate closed, the ONLY thing that makes audio is an explicit response.create
// from a "speak" decision — and none is ever sent for gated turns.
import {
  decideTurn,
  spokenMentionRegExp,
  type TurnPolicy,
  zapActive,
} from "@meet/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  RealtimeSession,
  type RealtimeSessionOptions,
} from "./realtime-session.js"

type Frame = Record<string, unknown> & { type: string }

class FakeWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.OPEN
  sent: Frame[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor() {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.())
  }
  send(data: string) {
    const frame = JSON.parse(data) as Frame
    this.sent.push(frame)
    // The server acks configuration; open() resolves on this, not onopen.
    if (frame.type === "session.update") {
      queueMicrotask(() =>
        this.onmessage?.({ data: JSON.stringify({ type: "session.updated" }) }),
      )
    }
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
}

const harness = async (policy: TurnPolicy) => {
  const state = { policy, zappedUntil: 0 }
  const onHandRaise = vi.fn()
  const decisions: string[] = []
  const opts: RealtimeSessionOptions = {
    model: "gpt-realtime",
    voice: "marin",
    apiKey: "test",
    instructions: "You are Scout.",
    transcriptionHint: 'An AI assistant named "Scout" may be addressed.',
    delegate: async () => "",
    onAudio: () => {},
    onInterrupt: () => {},
    gate: {
      mention: spokenMentionRegExp("Scout"),
      decide: (mentioned) =>
        decideTurn({
          policy: state.policy,
          channel: "voice",
          mentioned,
          zapped: zapActive(state.zappedUntil),
          callOnPending: false,
          muted: false,
          deafened: false,
        }),
      onHandRaise,
      onDecision: (_t, d) => decisions.push(d),
    },
  }
  const session = new RealtimeSession(opts)
  await session.open()
  const ws = FakeWebSocket.instances.at(-1)
  if (!ws) throw new Error("no socket")
  const receive = (event: Frame) =>
    ws.onmessage?.({ data: JSON.stringify(event) })
  const responsesCreated = () =>
    ws.sent.filter((f) => f.type === "response.create")
  return {
    session,
    state,
    ws,
    receive,
    responsesCreated,
    onHandRaise,
    decisions,
  }
}

const completedTurn = (transcript: string, item = "item-1"): Frame => ({
  type: "conversation.item.input_audio_transcription.completed",
  item_id: item,
  transcript,
})

describe("RealtimeSession wire-level gating", () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal("WebSocket", FakeWebSocket)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("gated session opens with create_response disabled — the model physically cannot start audio", async () => {
    const { ws } = await harness("on-mention")
    const setup = ws.sent.find((f) => f.type === "session.update") as Frame & {
      session: {
        audio: { input: { turn_detection: { create_response: boolean } } }
      }
    }
    expect(setup.session.audio.input.turn_detection.create_response).toBe(false)
  })

  it("on-mention: unaddressed turn → text-only deliberation, never audio", async () => {
    const { receive, responsesCreated } = await harness("on-mention")
    receive(completedTurn("let's talk about the roadmap"))
    const created = responsesCreated()
    expect(created).toHaveLength(1)
    expect(
      (created[0].response as { output_modalities: string[] })
        .output_modalities,
    ).toEqual(["text"])
  })

  it("on-mention: a mention creates a real (audio) response", async () => {
    const { receive, responsesCreated } = await harness("on-mention")
    receive(completedTurn("Scout, what do you think?"))
    const created = responsesCreated()
    expect(created).toHaveLength(1)
    expect(created[0].response).toBeUndefined()
  })

  it("raise-hand: a mention raises the hand and sends NO audible response", async () => {
    const { receive, responsesCreated, onHandRaise, decisions } =
      await harness("raise-hand")
    receive(completedTurn("Scout, what do you think?"))
    expect(onHandRaise).toHaveBeenCalledOnce()
    expect(responsesCreated()).toHaveLength(0)
    expect(decisions).toEqual(["raise-hand"])
  })

  it("raise-hand: the early partial-transcript path cannot fire either", async () => {
    const { receive, responsesCreated } = await harness("raise-hand")
    receive({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-1",
      delta: "hey Scout can you",
    })
    expect(responsesCreated()).toHaveLength(0)
  })

  it("on-mention: the early partial path fires exactly once, deduping the final", async () => {
    const { receive, responsesCreated } = await harness("on-mention")
    receive({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-1",
      delta: "hey Scout can you",
    })
    expect(responsesCreated()).toHaveLength(1)
    receive(completedTurn("hey Scout can you check staging?"))
    expect(responsesCreated()).toHaveLength(1) // deduped, not answered twice
  })

  it("zap: decide grants one turn via the zap window", async () => {
    const { receive, responsesCreated, state } = await harness("raise-hand")
    state.zappedUntil = Date.now() + 30_000
    receive(completedTurn("so, any thoughts?"))
    const created = responsesCreated()
    expect(created).toHaveLength(1)
    expect(created[0].response).toBeUndefined() // audible, not deliberation
  })

  it("gate lifted (open policy / zap window): auto-response is restored on the wire", async () => {
    const { session, ws } = await harness("on-mention")
    session.setGateOpen(true)
    const updates = ws.sent.filter((f) => f.type === "session.update")
    const last = updates.at(-1) as Frame & {
      session: {
        audio: { input: { turn_detection: { create_response: boolean } } }
      }
    }
    expect(last.session.audio.input.turn_detection.create_response).toBe(true)
  })

  it("a deliberation that answers RAISE_HAND raises the hand", async () => {
    const { receive, onHandRaise } = await harness("on-mention")
    receive({ type: "response.output_text.done", text: "RAISE_HAND" })
    expect(onHandRaise).toHaveBeenCalledOnce()
  })

  it("a mention during an active deliberation is queued, not dropped — the original miss", async () => {
    const { receive, responsesCreated } = await harness("on-mention")
    // Unaddressed turn starts a silent deliberation…
    receive(completedTurn("let's talk about the roadmap", "item-1"))
    expect(responsesCreated()).toHaveLength(1)
    // …and the mention lands while it's still running. Before the fix this
    // second response.create was rejected by the server and lost forever.
    receive(completedTurn("Scout, what do you think?", "item-2"))
    // Not sent yet (one active response), but queued; a cancel went out to
    // clear the deliberation.
    expect(responsesCreated()).toHaveLength(1)
    receive({ type: "response.done" })
    const created = responsesCreated()
    expect(created).toHaveLength(2)
    expect(created[1].response).toBeUndefined() // the audible reply
  })

  it("cancels an active deliberation to make way for a mention", async () => {
    const { receive, ws } = await harness("on-mention")
    receive(completedTurn("unrelated chatter", "item-1"))
    receive(completedTurn("Scout, you there?", "item-2"))
    expect(ws.sent.some((f) => f.type === "response.cancel")).toBe(true)
  })

  it("back-to-back deliberations never stack (second is skipped, not queued)", async () => {
    const { receive, responsesCreated } = await harness("on-mention")
    receive(completedTurn("first unaddressed turn", "item-1"))
    receive(completedTurn("second unaddressed turn", "item-2"))
    expect(responsesCreated()).toHaveLength(1)
  })

  it("interrupt drops whatever was queued", async () => {
    const { session, receive, responsesCreated } = await harness("on-mention")
    receive(completedTurn("unrelated chatter", "item-1"))
    receive(completedTurn("Scout, question for you", "item-2"))
    session.cancelResponse()
    receive({ type: "response.done" })
    expect(responsesCreated()).toHaveLength(1) // queued reply was discarded
  })

  it("failed and empty transcripts are logged as gate decisions", async () => {
    const { receive, decisions } = await harness("on-mention")
    receive({
      type: "conversation.item.input_audio_transcription.failed",
      item_id: "item-1",
    })
    receive(completedTurn("   ", "item-2"))
    expect(decisions).toEqual(["ignore", "ignore"])
  })

  it("the transcriber is biased toward the agent's name", async () => {
    const { ws } = await harness("on-mention")
    const setup = ws.sent.find((f) => f.type === "session.update") as Frame & {
      session: {
        audio: { input: { transcription: { model: string; prompt?: string } } }
      }
    }
    expect(setup.session.audio.input.transcription.prompt).toContain("Scout")
  })

  // notifyHeard is the only place a spoken turn's speaker gets attributed
  // (issue #193) — it must land as context without ever making the model
  // start talking on its own.
  it("notifyHeard surfaces the line as passive context, no response.create", async () => {
    const { session, ws, responsesCreated } = await harness("open")
    session.notifyHeard("[meeting audio] Amin: what's the weather like?")
    const item = ws.sent.find((f) => f.type === "conversation.item.create") as
      | (Frame & {
          item: { role: string; content: { text: string }[] }
        })
      | undefined
    expect(item?.item.role).toBe("user")
    expect(item?.item.content[0].text).toBe(
      "[meeting audio] Amin: what's the weather like?",
    )
    expect(responsesCreated()).toHaveLength(0)
  })
})
