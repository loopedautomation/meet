import { atom } from "nanostores"

/**
 * The LiveKit room name (ch-<publicId>) when the current session is a
 * channel, null for plain meetings. Set by RoomClient; consumed by the chat
 * panel to hydrate and persist the channel's text sidecar.
 */
export const $channelRoom = atom<string | null>(null)
