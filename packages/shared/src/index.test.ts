import { describe, expect, it } from "vitest"
import {
  type AgentControl,
  agentControlSchema,
  defaultRoomSettings,
  describeAgentControl,
  parseRoomSettings,
} from "./index.js"

describe("agentControlSchema", () => {
  it("accepts a control without actor fields, as older clients send", () => {
    const parsed = agentControlSchema.parse({ type: "mute", agentId: "scout" })
    expect(parsed.byName).toBeUndefined()
  })

  it("carries the actor when stamped", () => {
    const parsed = agentControlSchema.parse({
      type: "interrupt",
      agentId: "scout",
      by: "user-1",
      byName: "Gwinyai",
    })
    expect(parsed.byName).toBe("Gwinyai")
  })

  it("rejects an unknown control type", () => {
    expect(
      agentControlSchema.safeParse({ type: "explode", agentId: "scout" })
        .success,
    ).toBe(false)
  })
})

describe("describeAgentControl", () => {
  const cases: [AgentControl["type"], string][] = [
    ["mute", "muted Scout"],
    ["unmute", "unmuted Scout"],
    ["deafen", "deafened Scout"],
    ["undeafen", "undeafened Scout"],
    ["interrupt", "interrupted Scout"],
    ["call-on", "called on Scout"],
    ["zap", "zapped Scout"],
    ["remove", "removed Scout from the meeting"],
  ]

  it.each(cases)("describes %s", (type, expected) => {
    expect(describeAgentControl({ type, agentId: "scout" }, "Scout")).toBe(
      expected,
    )
  })

  it("names the policy when the turn policy changes", () => {
    expect(
      describeAgentControl(
        { type: "set-turn-policy", agentId: "scout", policy: "raise-hand" },
        "Scout",
      ),
    ).toBe("set Scout's response mode to raise-hand")
  })

  it("stays quiet on a policy change with no policy to report", () => {
    expect(
      describeAgentControl({ type: "set-turn-policy", agentId: "scout" }, "S"),
    ).toBeNull()
  })

  it("covers every control type, so a new one can't ship unannounced", () => {
    for (const type of agentControlSchema.shape.type.options) {
      const control: AgentControl = {
        type,
        agentId: "scout",
        ...(type === "set-turn-policy" ? { policy: "open" as const } : {}),
      }
      expect(describeAgentControl(control, "Scout")).toBeTruthy()
    }
  })
})

describe("parseRoomSettings", () => {
  it("defaults to open when a room has no metadata", () => {
    expect(parseRoomSettings(undefined)).toEqual(defaultRoomSettings)
    expect(parseRoomSettings("")).toEqual(defaultRoomSettings)
  })

  it("defaults to open for rooms created before settings existed", () => {
    const legacy = JSON.stringify({ hostKey: "k", started: true })
    expect(parseRoomSettings(legacy)).toEqual(defaultRoomSettings)
  })

  it("reads settings the host has saved", () => {
    const raw = JSON.stringify({
      hostKey: "k",
      settings: {
        participantsCanControlAgents: false,
        participantsCanInviteAgents: false,
      },
    })
    expect(parseRoomSettings(raw)).toEqual({
      participantsCanControlAgents: false,
      participantsCanInviteAgents: false,
    })
  })

  it("fills in a setting the host never touched", () => {
    const raw = JSON.stringify({
      settings: { participantsCanInviteAgents: false },
    })
    expect(parseRoomSettings(raw)).toEqual({
      participantsCanControlAgents: true,
      participantsCanInviteAgents: false,
    })
  })

  it("falls back to open rather than throwing on junk", () => {
    expect(parseRoomSettings("not json")).toEqual(defaultRoomSettings)
    expect(
      parseRoomSettings(
        JSON.stringify({ settings: { participantsCanControlAgents: "yes" } }),
      ),
    ).toEqual(defaultRoomSettings)
  })
})
