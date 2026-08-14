import {
  parseParticipantMeta,
  parseRoomSettings,
  type RoomSettings,
  roomMetadataSchema,
} from "@meet/shared"

type SenderLike = { identity: string; metadata?: string } | undefined
type RoomLike = { metadata?: string }

/**
 * Whether a data-channel agent action from this sender may be executed,
 * gated by `settingsKey` — the room-settings boolean that governs this
 * category of action. Defaults to `participantsCanControlAgents` (mute,
 * interrupt, turn-policy changes, …); pass `participantsCanPromptAgents` to
 * gate the separate "may drive the agent's turns" capability instead. Same
 * fail-closed logic either way, just parameterized on which key it reads —
 * a near-duplicate `promptAllowed` would only drift from this over time.
 *
 * The sender is the participant LiveKit actually delivered the packet from
 * — never an identity claimed inside the payload. Actions are refused when:
 * - there is no sender (server-injected or malformed packet),
 * - the sender isn't an admitted human (waiting users and agents can't
 *   drive agents),
 * - the host has reserved this category and the sender isn't the host
 *   identity stamped into room metadata by the host-authenticated settings
 *   route. If that setting is off but no host identity is known (metadata
 *   unreadable), fail closed.
 */
export function controlAllowed(
  room: RoomLike,
  sender: SenderLike,
  settingsKey: keyof RoomSettings = "participantsCanControlAgents",
): boolean {
  if (!sender) return false
  if (parseParticipantMeta(sender.metadata)?.kind !== "human") return false
  // Metadata that exists but can't be parsed fails closed: falling back to
  // the permissive defaults would let corrupt metadata reopen a room the
  // host locked down. Absent metadata is a legacy open room — defaults ok.
  if (room.metadata) {
    try {
      roomMetadataSchema.parse(JSON.parse(room.metadata))
    } catch {
      return false
    }
  }
  const settings = parseRoomSettings(room.metadata)
  if (settings[settingsKey]) return true
  try {
    const meta = roomMetadataSchema.parse(JSON.parse(room.metadata || "{}"))
    return !!meta.hostIdentity && meta.hostIdentity === sender.identity
  } catch {
    return false
  }
}
