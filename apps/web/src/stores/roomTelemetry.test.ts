import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  claimAgentReplyLatency,
  getRoomSnapshot,
  noteAgentAsked,
  resetRoomSnapshot,
  updateRoomSnapshot,
} from "./roomTelemetry"

describe("room telemetry snapshot", () => {
  beforeEach(() => resetRoomSnapshot())

  it("remembers the busiest the meeting ever got", () => {
    updateRoomSnapshot(2, [])
    updateRoomSnapshot(5, [])
    updateRoomSnapshot(1, [])
    expect(getRoomSnapshot().participantCount).toBe(1)
    expect(getRoomSnapshot().peakParticipantCount).toBe(5)
  })

  it("remembers an agent that has since left", () => {
    updateRoomSnapshot(2, ["scout"])
    updateRoomSnapshot(2, [])
    expect(getRoomSnapshot().agentTypes).toEqual([])
    expect(getRoomSnapshot().hadAgent).toBe(true)
  })

  it("resets between meetings", () => {
    updateRoomSnapshot(4, ["scout"])
    resetRoomSnapshot()
    expect(getRoomSnapshot()).toEqual({
      participantCount: 0,
      peakParticipantCount: 0,
      agentTypes: [],
      hadAgent: false,
    })
  })
})

describe("agent reply latency", () => {
  beforeEach(() => {
    resetRoomSnapshot()
    vi.useRealTimers()
  })

  it("times a reply against the question that prompted it", () => {
    vi.useFakeTimers()
    noteAgentAsked("scout")
    vi.advanceTimersByTime(1_500)
    expect(claimAgentReplyLatency()).toBe(1_500)
  })

  it("counts a reply only once", () => {
    noteAgentAsked("scout")
    expect(claimAgentReplyLatency()).not.toBeNull()
    expect(claimAgentReplyLatency()).toBeNull()
  })

  it("ignores an unprompted reply", () => {
    expect(claimAgentReplyLatency()).toBeNull()
  })

  it("discards a question too old to have been answered", () => {
    vi.useFakeTimers()
    noteAgentAsked("scout")
    vi.advanceTimersByTime(200_000)
    expect(claimAgentReplyLatency()).toBeNull()
  })
})
