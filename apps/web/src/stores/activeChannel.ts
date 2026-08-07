import { atom } from "nanostores"

/**
 * Slug of the channel currently mounted in the main pane, null otherwise.
 * Set by TextChannelView on mount/unmount. Used to suppress a message
 * notification for a channel the viewer already has open and focused.
 */
export const $activeChannelSlug = atom<string | null>(null)
