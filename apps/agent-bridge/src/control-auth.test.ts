import type { ParticipantMeta, RoomSettings } from "@meet/shared"
import { describe, expect, it } from "vitest"
import { controlAllowed } from "./control-auth.js"

function meta(kind: ParticipantMeta["kind"]): string {
  return JSON.stringify({ kind } satisfies ParticipantMeta)
}

function roomMeta(
  settings: Partial<RoomSettings>,
  hostIdentity?: string,
): string {
  return JSON.stringify({ started: true, settings, hostIdentity })
}

const human = (identity: string) => ({ identity, metadata: meta("human") })

describe("controlAllowed", () => {
  it("rejects a control with no sender (server-injected/malformed packet)", () => {
    expect(controlAllowed({ metadata: roomMeta({}) }, undefined)).toBe(false)
  })

  it("rejects a waiting-room participant", () => {
    expect(
      controlAllowed(
        { metadata: roomMeta({}) },
        { identity: "user-w", metadata: meta("waiting") },
      ),
    ).toBe(false)
  })

  it("rejects an agent trying to drive another agent", () => {
    expect(
      controlAllowed(
        { metadata: roomMeta({}) },
        { identity: "agent-x", metadata: meta("agent") },
      ),
    ).toBe(false)
  })

  it("allows any admitted human when controls are open", () => {
    expect(
      controlAllowed(
        { metadata: roomMeta({ participantsCanControlAgents: true }) },
        human("user-1"),
      ),
    ).toBe(true)
  })

  it("allows only the host identity when controls are reserved", () => {
    const room = {
      metadata: roomMeta({ participantsCanControlAgents: false }, "user-host"),
    }
    expect(controlAllowed(room, human("user-host"))).toBe(true)
    expect(controlAllowed(room, human("user-other"))).toBe(false)
  })

  it("fails closed when controls are reserved but no host identity is known", () => {
    const room = {
      metadata: roomMeta({ participantsCanControlAgents: false }),
    }
    expect(controlAllowed(room, human("user-1"))).toBe(false)
  })

  it("fails closed on unparseable room metadata (corrupt metadata can't reopen a locked room)", () => {
    expect(controlAllowed({ metadata: "{not json" }, human("user-1"))).toBe(
      false,
    )
  })

  it("treats a legacy room with no metadata as open", () => {
    expect(controlAllowed({ metadata: undefined }, human("user-1"))).toBe(true)
  })
})
