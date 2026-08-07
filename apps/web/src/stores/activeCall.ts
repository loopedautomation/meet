import { atom } from "nanostores"

/**
 * The channel call currently connected, independent of which channel page
 * is being viewed — set on join, cleared on a real leave. `room` is the
 * LiveKit room name (ch-<id>, what RoomClient's `slug` prop expects);
 * `channelSlug` is the human URL slug, kept alongside so the background
 * call bar can show a label without an extra fetch.
 */
export const $activeCall = atom<{ room: string; channelSlug: string } | null>(
  null,
)
