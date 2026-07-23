import {
  parseParticipantMeta,
  parseRoomSettings,
  roomMetadataSchema,
} from "@meet/shared"

type SenderLike = { identity: string; metadata?: string } | undefined
type RoomLike = { metadata?: string }

/**
 * Whether a data-channel agent control from this sender may be executed.
 *
 * The sender is the participant LiveKit actually delivered the packet from
 * — never an identity claimed inside the payload. Controls are refused when:
 * - there is no sender (server-injected or malformed packet),
 * - the sender isn't an admitted human (waiting users and agents can't
 *   drive agents),
 * - the host has reserved agent controls and the sender isn't the host
 *   identity stamped into room metadata by the host-authenticated settings
 *   route. If that setting is off but no host identity is known (metadata
 *   unreadable), fail closed.
 */
export function controlAllowed(room: RoomLike, sender: SenderLike): boolean {
  if (!sender) return false
  if (parseParticipantMeta(sender.metadata)?.kind !== "human") return false
  const settings = parseRoomSettings(room.metadata)
  if (settings.participantsCanControlAgents) return true
  try {
    const meta = roomMetadataSchema.parse(JSON.parse(room.metadata || "{}"))
    return !!meta.hostIdentity && meta.hostIdentity === sender.identity
  } catch {
    return false
  }
}
