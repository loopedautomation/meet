import { serializeAgentBroadcast } from "@meet/shared"

/**
 * An identity no real participant ever has. LiveKit's `publishData` treats
 * an *empty* `destination_identities` array as "send to everyone" (see the
 * SDK's own `DataPublishOptions` doc: "will be sent to every one if
 * empty") — so "this session has no known owner yet" cannot be modeled as
 * `[]` without leaking room-wide. Routing to this unreachable identity
 * instead keeps a not-yet-owned, non-broadcasting session private (visible
 * to nobody) rather than accidentally public.
 */
const NO_OWNER_YET = "__no-broadcast-owner__"

/**
 * Where a session's activity events should be delivered, given the
 * per-session broadcast toggle and who currently owns the session (whoever
 * sent it its most recent prompt).
 *
 * Returns `undefined` for "everyone" — the same shape `publishData` already
 * uses for a plain broadcast — or a `destination_identities` array scoped to
 * just the owner. Pulled out of the worker's `publishActivity` as a pure
 * function because the decision itself, not the LiveKit plumbing around it,
 * is what needs to be exhaustively testable.
 */
export function activityDestinations(
  broadcastEnabled: boolean,
  lastPromptBy: string | null,
): string[] | undefined {
  if (broadcastEnabled) return undefined
  return [lastPromptBy ?? NO_OWNER_YET]
}

/** The bits of `SessionState` the "set-broadcast" control reads/writes. */
export interface BroadcastToggleState {
  broadcastEnabled: boolean
  lastPromptBy: string | null
  lastPromptByName: string | null
}

/**
 * Applies a "set-broadcast" `AgentControl` to session state and returns the
 * `AGENT_BROADCAST_ATTRIBUTE` value the caller must publish via
 * `local.setAttributes`.
 *
 * Pulled out so every `dataReceived` listener that owns this control (the
 * worker has two — one for realtime agents, one for pipeline agents, since
 * only mute/deafen/turn-policy/broadcast are common to both while
 * audio-affecting controls like barge-in need the mode-specific session
 * object) calls through the *same* implementation instead of hand-copying
 * the `serializeAgentBroadcast(...)` call. A hand-copy is exactly how the
 * realtime listener ended up silently missing this control in the first
 * place (#275) — it was added only to the pipeline listener's switch.
 */
export function applySetBroadcast(
  state: BroadcastToggleState,
  broadcast: boolean,
): string {
  state.broadcastEnabled = broadcast
  return serializeAgentBroadcast(
    broadcast
      ? {
          on: true,
          by: state.lastPromptBy ?? undefined,
          byName: state.lastPromptByName ?? undefined,
        }
      : { on: false },
  )
}
