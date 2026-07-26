import { describe, expect, it } from "vitest"
import {
  decideTurn,
  requestsSpeech,
  type TurnGateInput,
  zapActive,
} from "./turn-gate.js"

const base: TurnGateInput = {
  policy: "open",
  channel: "voice",
  mentioned: false,
  zapped: false,
  callOnPending: false,
  muted: false,
  deafened: false,
}

const turn = (over: Partial<TurnGateInput>) => decideTurn({ ...base, ...over })

describe("decideTurn: voice", () => {
  it("open policy always speaks", () => {
    expect(turn({})).toMatchObject({ action: "speak", via: "open" })
    expect(turn({ mentioned: true })).toMatchObject({ action: "speak" })
  })

  it("deafened ignores every voice turn, on any policy and even zapped", () => {
    for (const policy of ["open", "on-mention", "raise-hand"] as const) {
      expect(
        turn({ policy, deafened: true, mentioned: true, zapped: true }),
      ).toEqual({ action: "ignore", reason: "deafened" })
    }
  })

  describe("on-mention", () => {
    it("unmentioned turn deliberates silently — never speaks", () => {
      expect(turn({ policy: "on-mention" })).toEqual({
        action: "deliberate",
        mayChat: true,
      })
    })
    it("mention grants the floor", () => {
      expect(turn({ policy: "on-mention", mentioned: true })).toMatchObject({
        action: "speak",
        via: "mention",
        consumeZap: false,
      })
    })
    it("zap grants the floor and is consumed", () => {
      expect(turn({ policy: "on-mention", zapped: true })).toMatchObject({
        action: "speak",
        via: "zap",
        consumeZap: true,
      })
    })
    it("call-on outranks zap and consumes only itself", () => {
      expect(
        turn({ policy: "on-mention", callOnPending: true, zapped: true }),
      ).toMatchObject({
        action: "speak",
        via: "call-on",
        consumeCallOn: true,
        consumeZap: false,
      })
    })
  })

  describe("raise-hand", () => {
    it("unmentioned turn deliberates silently", () => {
      expect(turn({ policy: "raise-hand" })).toEqual({
        action: "deliberate",
        mayChat: true,
      })
    })
    it("a bare mention only raises the hand — speaking is impossible", () => {
      expect(turn({ policy: "raise-hand", mentioned: true })).toEqual({
        action: "raise-hand",
      })
    })
    it("call-on grants the floor", () => {
      expect(
        turn({ policy: "raise-hand", callOnPending: true }),
      ).toMatchObject({ action: "speak", via: "call-on", consumeCallOn: true })
    })
    it("zap outranks the mention rule (explicit human summons), one-shot", () => {
      expect(
        turn({ policy: "raise-hand", zapped: true, mentioned: true }),
      ).toMatchObject({ action: "speak", via: "zap", consumeZap: true })
    })
  })
})

describe("decideTurn: chat", () => {
  const chat = (over: Partial<TurnGateInput>) =>
    turn({ channel: "chat", mentioned: true, ...over })

  it("no mention → not addressed", () => {
    expect(turn({ channel: "chat" })).toEqual({
      action: "ignore",
      reason: "not-addressed",
    })
  })

  it("plain chat mention replies in chat under open and raise-hand", () => {
    expect(chat({ policy: "open" })).toEqual({ action: "reply-in-chat" })
    expect(chat({ policy: "raise-hand" })).toEqual({ action: "reply-in-chat" })
  })

  it("plain chat mention under on-mention may answer aloud", () => {
    expect(chat({ policy: "on-mention" })).toMatchObject({
      action: "speak",
      via: "chat-mention",
    })
  })

  it("on-mention falls back to chat when muted or deafened", () => {
    expect(chat({ policy: "on-mention", muted: true })).toEqual({
      action: "reply-in-chat",
    })
    expect(chat({ policy: "on-mention", deafened: true })).toEqual({
      action: "reply-in-chat",
    })
  })

  it("deafened still gets chat replies (the deafen contract)", () => {
    expect(chat({ policy: "open", deafened: true })).toEqual({
      action: "reply-in-chat",
    })
  })

  describe("explicit speak request", () => {
    it("raise-hand raises the hand instead of speaking", () => {
      expect(chat({ policy: "raise-hand", speakRequested: true })).toEqual({
        action: "raise-hand",
      })
    })
    it("open and on-mention answer aloud", () => {
      for (const policy of ["open", "on-mention"] as const) {
        expect(chat({ policy, speakRequested: true })).toMatchObject({
          action: "speak",
          via: "chat-mention",
        })
      }
    })
    it("muted or deafened fall back to chat", () => {
      expect(chat({ policy: "open", speakRequested: true, muted: true })).toEqual(
        { action: "reply-in-chat" },
      )
      expect(
        chat({ policy: "open", speakRequested: true, deafened: true }),
      ).toEqual({ action: "reply-in-chat" })
    })
  })
})

describe("zap window semantics", () => {
  it("zapActive is a strict deadline", () => {
    expect(zapActive(1000, 999)).toBe(true)
    expect(zapActive(1000, 1000)).toBe(false)
    expect(zapActive(0, 1)).toBe(false)
  })

  it("one-shot: consuming the zap re-gates the very next turn", () => {
    // Simulates the caller contract: speak-via-zap → zappedUntil = 0.
    const first = turn({ policy: "raise-hand", zapped: true })
    expect(first).toMatchObject({ action: "speak", via: "zap", consumeZap: true })
    const next = turn({ policy: "raise-hand", zapped: false })
    expect(next).toEqual({ action: "deliberate", mayChat: true })
  })

  it("policy flip mid-zap: caller clears zappedUntil, so no leak", () => {
    // set-turn-policy clears the window; the decision sees zapped: false.
    expect(turn({ policy: "raise-hand", zapped: false, mentioned: true })).toEqual(
      { action: "raise-hand" },
    )
  })
})

describe("requestsSpeech", () => {
  it("matches explicit asks to answer aloud", () => {
    expect(requestsSpeech("@Scout can you say it out loud?")).toBe(true)
    expect(requestsSpeech("Scout, tell us aloud what you found")).toBe(true)
    expect(requestsSpeech("@Scout answer verbally please")).toBe(true)
    expect(requestsSpeech("scout speak up about the deploy")).toBe(true)
  })
  it("stays quiet on ordinary chat", () => {
    expect(requestsSpeech("@Scout what's the deploy status?")).toBe(false)
    expect(requestsSpeech("Scout can you post the link?")).toBe(false)
    expect(requestsSpeech("I spoke to Sam earlier")).toBe(false)
    expect(requestsSpeech("that's a loud design choice")).toBe(false)
  })
})
