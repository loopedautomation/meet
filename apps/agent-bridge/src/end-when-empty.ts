import type { JobContext } from "@livekit/agents"
import { parseParticipantMeta } from "@meet/shared"

/**
 * Does the room still hold anyone the agent is here to talk to? Only humans
 * count. Agents and the transcriber "service" participant keep the room
 * technically populated, so they must be excluded — otherwise a room with a
 * lone agent (and the always-present transcriber) never reads as empty and
 * LiveKit's emptyTimeout never fires. Missing or unparseable metadata is
 * treated as human, matching the transcriber's own rule, so a stray client is
 * never mistaken for infrastructure and stranded.
 */
export function hasHumanParticipant(
  participants: Iterable<{ metadata?: string }>,
): boolean {
  for (const p of participants) {
    const meta = parseParticipantMeta(p.metadata)
    if (!meta || meta.kind === "human") return true
  }
  return false
}

/** How long an empty room lingers before the call is torn down. */
export function emptyRoomGraceMs(): number {
  const seconds = Number(process.env.AGENT_EMPTY_ROOM_GRACE_SECONDS ?? 15)
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 15) * 1000
}

/**
 * End the call once every human has gone. The agent stays put through the
 * usual churn — a lone participant refreshing, someone dropping and
 * reconnecting — so a grace window absorbs those before acting; a human
 * rejoining inside the window cancels the countdown. When it does fire, the
 * whole call is torn down (deleteRoom disconnects this agent, any co-agents,
 * and the transcriber), so nothing lingers billing an idle realtime session.
 */
export function endCallWhenEmpty(
  ctx: JobContext,
  graceMs: number = emptyRoomGraceMs(),
): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const evaluate = () => {
    if (hasHumanParticipant(ctx.room.remoteParticipants.values())) {
      cancel()
      return
    }
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      // Re-check: a human may have slipped in during the grace window.
      if (hasHumanParticipant(ctx.room.remoteParticipants.values())) return
      // deleteRoom already disconnects us; shutdown is the fallback if the
      // room is gone (a co-agent won the race and deleted it first).
      void ctx.deleteRoom().catch(() => ctx.shutdown("everyone left the call"))
    }, graceMs)
  }
  ctx.room.on("participantConnected", evaluate)
  ctx.room.on("participantDisconnected", evaluate)
  ctx.addShutdownCallback(async () => cancel())
  // The inviter may have left before the agent finished joining; the grace
  // window also covers a roster that is still settling right after connect.
  evaluate()
}
