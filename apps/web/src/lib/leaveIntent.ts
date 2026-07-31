// LiveKit calls `disconnect()` on both `beforeunload` and `pagehide` to flush
// a leave message — so a page reload or tab close reports the exact same
// DisconnectReason.CLIENT_INITIATED as clicking the "Leave meeting" button.
// The reason alone can't tell them apart; the Leave button marks its intent
// here right before calling disconnect() so RoomClient can tell a real leave
// from the browser tearing the page down.
let explicitLeave = false

export function markExplicitLeave() {
  explicitLeave = true
}

/** Reads and clears the flag — a one-shot check for the next disconnect. */
export function consumeExplicitLeave(): boolean {
  const was = explicitLeave
  explicitLeave = false
  return was
}
