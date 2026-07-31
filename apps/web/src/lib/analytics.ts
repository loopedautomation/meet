import posthog from "posthog-js"

/** How an agent left the call. */
export type AgentRemovalReason = "user_removed" | "call_ended" | "error"

/** The ways a participant addresses an agent without sending it a message. */
export type AgentInteractionKind = "control" | "push_to_talk"

/**
 * Event schema for anonymous usage telemetry. Property values must never
 * include room slugs, participant names, or any user content.
 *
 * In-room events additionally carry `room_id` (see setRoomContext) as a
 * registered super property, so every event from one meeting can be grouped
 * without any call site passing it.
 */
type Events = {
  room_created: undefined
  room_joined: { role: "host" | "guest"; via_waiting_room: boolean }
  room_join_failed: { reason: "not_found" | "network" | "server" }
  room_left: {
    duration_seconds: number
    participant_count: number
    had_ai_agent: boolean
    role: "host" | "guest"
  }
  room_ended: {
    participant_count: number
    peak_participant_count: number
    duration_seconds: number
    had_ai_agent: boolean
    agent_count: number
  }
  waiting_room_entered: undefined
  waiting_room_admitted: { waited_seconds: number }
  waiting_room_abandoned: { waited_seconds: number }

  agent_added: {
    agent_type: string
    added_by_role: "host" | "guest"
    /** Which brain fronts the agent: realtime, gemini, pipeline… */
    mode: string
  }
  agent_removed: { agent_type?: string; reason: AgentRemovalReason }
  agent_message_sent: { agent_type: string; message_length: number }
  agent_message_received: { agent_type: string; response_latency_ms: number }
  agent_error: { agent_type: string; error_code: string }
  agent_interaction: { kind: AgentInteractionKind; agent_count: number }
  /**
   * `value` is what the control was set *to* — the turn policy, chattiness,
   * or barge-in flag. Without it "someone changed the turn policy" says
   * nothing about which behaviour people actually want.
   */
  agent_control_used: { control: string; value?: string }
  /** What the agent actually did: one tool call it completed. */
  agent_tool_used: {
    agent_type: string
    tool: string
    /** "brain" = the agent's own reasoning tools; "body" = meeting surfaces. */
    source: string
    duration_ms: number
  }

  camera_toggled: { state: "on" | "off" }
  microphone_toggled: { state: "on" | "off" }
  hand_raised: undefined
  screenshare_started: undefined
  screenshare_stopped: { duration_seconds: number }
  whiteboard_opened: undefined
  panel_opened: { panel: string }
  doc_panel_opened: undefined
  chat_message_sent: { is_to_agent: boolean }
  transcription_enabled: undefined
  camera_effect_applied: { effect: string }
  push_to_talk_used: undefined
}

let enabled = false
// React runs child effects before parent ones, so a room can register its
// context before TelemetryProvider has finished init. Remember it and apply
// it once posthog is up.
let currentRoom: string | null = null

/** Called once by TelemetryProvider after posthog.init succeeds. */
export function markTelemetryReady() {
  enabled = true
  if (currentRoom) setRoomContext(currentRoom)
}

/**
 * An opaque, stable id for a meeting. Room slugs are meeting codes and must
 * never leave the browser, so events carry a digest of the slug instead:
 * everyone in the same meeting derives the same value, and it means nothing
 * outside the event stream. Two FNV-style passes in opposite directions give
 * 64 bits without pulling in a hash dependency or an async crypto call.
 */
function hashRoomId(slug: string): string {
  let forward = 0x811c9dc5
  for (let i = 0; i < slug.length; i++) {
    forward = Math.imul(forward ^ slug.charCodeAt(i), 0x01000193) >>> 0
  }
  let backward = 0x811c9dc5
  for (let i = slug.length - 1; i >= 0; i--) {
    backward = Math.imul(backward ^ slug.charCodeAt(i), 0x85ebca6b) >>> 0
  }
  return (
    forward.toString(16).padStart(8, "0") +
    backward.toString(16).padStart(8, "0")
  )
}

/** Attach a room to every subsequent event, until clearRoomContext(). */
export function setRoomContext(slug: string) {
  if (typeof window === "undefined") return
  currentRoom = slug
  if (!enabled) return
  try {
    posthog.register({ room_id: hashRoomId(slug) })
  } catch {}
}

export function clearRoomContext() {
  if (typeof window === "undefined") return
  currentRoom = null
  if (!enabled) return
  try {
    posthog.unregister("room_id")
  } catch {}
}

export function track<E extends keyof Events>(
  event: E,
  ...args: Events[E] extends undefined ? [] : [props: Events[E]]
) {
  if (typeof window === "undefined" || !enabled) return
  try {
    posthog.capture(event, args[0])
  } catch {
    // Telemetry must never break the app.
  }
}
