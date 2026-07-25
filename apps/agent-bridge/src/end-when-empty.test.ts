import type { ParticipantMeta } from "@meet/shared"
import { describe, expect, it } from "vitest"
import { hasHumanParticipant } from "./end-when-empty.js"

function participant(meta: ParticipantMeta | null): { metadata?: string } {
  return { metadata: meta ? JSON.stringify(meta) : undefined }
}

describe("hasHumanParticipant", () => {
  it("is false for an empty room", () => {
    expect(hasHumanParticipant([])).toBe(false)
  })

  it("is false when only agents and the transcriber service remain", () => {
    expect(
      hasHumanParticipant([
        participant({ kind: "agent", agentId: "scout" }),
        participant({ kind: "service", service: "transcriber" }),
      ]),
    ).toBe(false)
  })

  it("does not count a waiting-room knocker as present", () => {
    expect(hasHumanParticipant([participant({ kind: "waiting" })])).toBe(false)
  })

  it("is true when a human is still in the call", () => {
    expect(
      hasHumanParticipant([
        participant({ kind: "agent", agentId: "scout" }),
        participant({ kind: "human" }),
      ]),
    ).toBe(true)
  })

  it("treats missing or unparseable metadata as human", () => {
    expect(hasHumanParticipant([participant(null)])).toBe(true)
    expect(hasHumanParticipant([{ metadata: "not-json" }])).toBe(true)
  })
})
