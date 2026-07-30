import posthog from "posthog-js"

/**
 * Event schema for anonymous usage telemetry. Property values must never
 * include room slugs, participant names, or any user content.
 */
type Events = {
  room_created: undefined
  room_joined: { role: "host" | "guest"; via_waiting_room: boolean }
  room_left: { duration_seconds: number; reason: string }
  agent_invited: { agent_type: string }
  agent_removed: { agent_type?: string }
  agent_control_used: { control: string }
  screenshare_started: undefined
  whiteboard_opened: undefined
  doc_panel_opened: undefined
  chat_message_sent: undefined
  transcription_enabled: undefined
  camera_effect_applied: { effect: string }
  push_to_talk_used: undefined
}

let enabled = false

/** Called once by TelemetryProvider after posthog.init succeeds. */
export function markTelemetryReady() {
  enabled = true
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
