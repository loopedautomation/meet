"use client"

import { useStore } from "@nanostores/react"
import { useEffect, useRef } from "react"
import { $activeCall } from "@/stores/activeCall"
import { $channelRoom } from "@/stores/channelContext"

/**
 * Rendered by the voice-channel page instead of RoomClient directly. The
 * actual call connection lives in AppShell (hoisted above route changes) so
 * navigating away doesn't tear it down — this component only registers
 * "the user is viewing this channel" and, if nothing else is connected,
 * auto-joins it once (Discord-style: viewing an unoccupied voice channel IS
 * joining it). It deliberately never clears $activeCall on unmount — that
 * would reintroduce the bug this fix exists for.
 */
export function JoinChannelCall({
  room,
  channelSlug,
}: {
  room: string
  channelSlug: string
}) {
  const activeCall = useStore($activeCall)
  // Auto-join fires once per mount — an explicit Leave (which clears
  // $activeCall while this page is still open) must not silently
  // re-trigger it, so the manual "Join" fallback below takes over instead.
  const autoJoinedRef = useRef(false)

  useEffect(() => {
    $channelRoom.set(room)
    return () => $channelRoom.set(null)
  }, [room])

  useEffect(() => {
    if (!$activeCall.get() && !autoJoinedRef.current) {
      autoJoinedRef.current = true
      $activeCall.set({ room, channelSlug })
    }
  }, [room, channelSlug])

  if (activeCall && activeCall.room !== room) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-medium text-lg">
          You're in a call in #{activeCall.channelSlug}
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => $activeCall.set({ room, channelSlug })}
        >
          Leave that call and join #{channelSlug} instead
        </button>
      </main>
    )
  }

  if (!activeCall) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-base-content/60 text-sm">
          You left #{channelSlug}.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            autoJoinedRef.current = true
            $activeCall.set({ room, channelSlug })
          }}
        >
          Join #{channelSlug}
        </button>
      </main>
    )
  }

  return null
}
