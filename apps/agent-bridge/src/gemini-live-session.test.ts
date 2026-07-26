// Validates GeminiLiveSession's gating at the WIRE level with a fake
// WebSocket: in manual-turn mode automatic activity detection is disabled in
// the setup frame (the model cannot decide a turn ended, so it cannot decide
// to speak), withheld speech goes in with turnComplete: false (cannot
// trigger a response), and turn audio is only ever delivered as an explicit
// activityStart/activityEnd envelope.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GeminiLiveSession } from "./gemini-live-session.js"
import type { RealtimeSessionOptions } from "./realtime-session.js"

type Frame = Record<string, any>

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.OPEN
  sent: Frame[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  constructor() {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.onopen?.()
      // Gemini acks setup; open() resolves on this frame.
      this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) })
    })
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
    this.onclose?.({ code: 1000, reason: "" })
  }
}

const opts: RealtimeSessionOptions = {
  model: "gemini-live-test",
  voice: "Puck",
  apiKey: "test",
  instructions: "You are Scout.",
  delegate: async () => "",
  onAudio: () => {},
  onInterrupt: () => {},
}

describe("GeminiLiveSession wire-level gating", () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal("WebSocket", FakeWebSocket)
  })
  afterEach(() => vi.unstubAllGlobals())

  const openSession = async (manualTurns: boolean) => {
    const session = new GeminiLiveSession(opts, { manualTurns })
    await session.open()
    const ws = FakeWebSocket.instances.at(-1)
    if (!ws) throw new Error("no socket")
    return { session, ws }
  }

  it("manual-turn setup disables automatic activity detection on the wire", async () => {
    const { ws } = await openSession(true)
    const setup = ws.sent.find((f) => f.setup)
    expect(
      setup?.setup.realtimeInputConfig.automaticActivityDetection.disabled,
    ).toBe(true)
  })

  it("open-policy setup keeps Gemini's own turn detection", async () => {
    const { ws } = await openSession(false)
    const setup = ws.sent.find((f) => f.setup)
    expect(setup?.setup.realtimeInputConfig).toBeUndefined()
  })

  it("withheld speech (notifyHeard) can never complete a turn", async () => {
    const { session, ws } = await openSession(true)
    session.notifyHeard("[meeting audio] Sam: unaddressed chatter")
    const frame = ws.sent.find((f) => f.clientContent)
    expect(frame?.clientContent.turnComplete).toBe(false)
  })

  it("turn audio is delivered only as an explicit activity envelope", async () => {
    const { session, ws } = await openSession(true)
    session.sendTurnAudio(new Uint8Array([1, 2, 3, 4]))
    const inputs = ws.sent.filter((f) => f.realtimeInput)
    expect(inputs[0].realtimeInput.activityStart).toBeDefined()
    expect(inputs.at(-1)?.realtimeInput.activityEnd).toBeDefined()
    expect(inputs.some((f) => f.realtimeInput.audio)).toBe(true)
  })

  it("empty turn audio sends nothing at all", async () => {
    const { session, ws } = await openSession(true)
    const before = ws.sent.length
    session.sendTurnAudio(new Uint8Array(0))
    expect(ws.sent.length).toBe(before)
  })

  it("closing the gate on an auto session flips to manual over a reconnect", async () => {
    const { session, ws } = await openSession(false)
    expect(session.manualTurns).toBe(false)
    session.setGateOpen(false)
    expect(session.manualTurns).toBe(true)
    expect(ws.readyState).toBe(3) // old socket dropped; reconnect re-runs setup
  })

  it("deliberation runs out-of-band — nothing touches the live socket", async () => {
    const { session, ws } = await openSession(true)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "RAISE_HAND" }] } }],
        }),
      })),
    )
    const before = ws.sent.length
    const verdict = await session.deliberate("Sam: someone should check")
    expect(verdict).toBe("raise-hand")
    expect(ws.sent.length).toBe(before) // no live-session frames sent
  })
})
