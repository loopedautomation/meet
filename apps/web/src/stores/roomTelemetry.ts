/**
 * A running picture of the meeting for telemetry only. Lives outside React
 * because the events that need it (room_left, room_ended) fire from
 * RoomClient, which sits above the LiveKit context where participants are
 * observable — and because the numbers must survive the unmount that a
 * disconnect triggers.
 */
export type RoomSnapshot = {
  /** Humans in the call, agents excluded. */
  participantCount: number
  /** Highest human count seen, so short joins don't hide a big meeting. */
  peakParticipantCount: number
  /** Agent ids currently in the call. */
  agentTypes: string[]
  /** Whether an agent was ever present, even if it left before the end. */
  hadAgent: boolean
}

let snapshot: RoomSnapshot = {
  participantCount: 0,
  peakParticipantCount: 0,
  agentTypes: [],
  hadAgent: false,
}

export function updateRoomSnapshot(
  participantCount: number,
  agentTypes: string[],
) {
  snapshot = {
    participantCount,
    peakParticipantCount: Math.max(
      snapshot.peakParticipantCount,
      participantCount,
    ),
    agentTypes,
    hadAgent: snapshot.hadAgent || agentTypes.length > 0,
  }
}

export function getRoomSnapshot(): RoomSnapshot {
  return snapshot
}

export function resetRoomSnapshot() {
  snapshot = {
    participantCount: 0,
    peakParticipantCount: 0,
    agentTypes: [],
    hadAgent: false,
  }
  pendingAsk = null
}

/**
 * The last message this participant addressed to an agent, kept so the
 * agent's reply can be timed. Only one is held: a second question before
 * the first is answered restarts the clock, which is the latency the person
 * actually experiences.
 */
let pendingAsk: { at: number; agentType: string } | null = null

export function noteAgentAsked(agentType: string) {
  pendingAsk = { at: Date.now(), agentType }
}

/**
 * Claims the pending question if this reply plausibly answers it, returning
 * the round-trip in ms. Replies to nobody's question (an agent speaking on
 * its own) return null and are not counted.
 */
export function claimAgentReplyLatency(): number | null {
  if (!pendingAsk) return null
  // The reply may come from a different agent than the one @-mentioned, so
  // only an unreasonably old pending ask is rejected.
  const latency = Date.now() - pendingAsk.at
  if (latency > 120_000) {
    pendingAsk = null
    return null
  }
  pendingAsk = null
  return latency
}
