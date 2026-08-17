"use client"

import { useDataChannel, useLocalParticipant } from "@livekit/components-react"
import {
  DataTopic,
  type ScreenShareControl,
  screenShareControlSchema,
} from "@meet/shared"
import type { Participant } from "livekit-client"
import { useCallback, useEffect, useRef, useState } from "react"

/** Minimal shape `useDataChannel` actually invokes handlers with. */
type DataChannelMessage = { payload: Uint8Array; from?: Participant }

/**
 * Enforces a single screen share on the stage. When this participant starts
 * sharing, it broadcasts a "takeover"; any other participant already sharing
 * stops. The hook also tracks who most recently took over so the stage can
 * prefer the newest share during the brief window where two are still live.
 *
 * Returns the identity of the latest sharer, or undefined if nobody has
 * announced a share this session (e.g. a share already running when we joined).
 */
export function useScreenShareTakeover(): string | undefined {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant()
  const [latestSharer, setLatestSharer] = useState<string>()

  // useDataChannel's callback closes over the first render's values, so read
  // the reactive bits through refs to avoid acting on stale state.
  const sharingRef = useRef(isScreenShareEnabled)
  sharingRef.current = isScreenShareEnabled
  const participantRef = useRef(localParticipant)
  participantRef.current = localParticipant
  // When our own share started — a takeover that predates it is a stale
  // broadcast from an older sharer and must not stop our newer share.
  const myShareStartedAt = useRef(0)

  // Memoized so useDataChannel's onMessage identity stays stable across
  // renders — an inline callback here recreates the hook's internal message
  // observable on every render, which can cascade into a React "Maximum
  // update depth exceeded" loop under normal data-channel traffic (#294).
  const handleScreenShare = useCallback((msg: DataChannelMessage) => {
    let parsed: ReturnType<typeof screenShareControlSchema.safeParse>
    try {
      parsed = screenShareControlSchema.safeParse(
        JSON.parse(new TextDecoder().decode(msg.payload)),
      )
    } catch {
      return
    }
    if (!parsed.success) return
    const { from, at } = parsed.data
    setLatestSharer(from)
    // Someone started sharing after us — yield the stage if we're still live.
    if (sharingRef.current && at > myShareStartedAt.current) {
      void participantRef.current
        .setScreenShareEnabled(false)
        .catch(() => undefined)
    }
  }, [])
  const { send } = useDataChannel(DataTopic.ScreenShare, handleScreenShare)

  // Announce a takeover on the moment our share turns on (false -> true), not
  // on every render — and only once the capture actually started, so a
  // cancelled picker never tells others to stop.
  const wasSharing = useRef(false)
  useEffect(() => {
    if (isScreenShareEnabled && !wasSharing.current) {
      const at = Date.now()
      myShareStartedAt.current = at
      setLatestSharer(localParticipant.identity)
      const control: ScreenShareControl = {
        type: "takeover",
        from: localParticipant.identity,
        at,
      }
      void send(new TextEncoder().encode(JSON.stringify(control)), {
        topic: DataTopic.ScreenShare,
        reliable: true,
      })
    }
    wasSharing.current = isScreenShareEnabled
  }, [isScreenShareEnabled, localParticipant, send])

  return latestSharer
}
