"use client"

import type { TrackReferenceOrPlaceholder } from "@livekit/components-react"
import { useSpeakingParticipants } from "@livekit/components-react"
import { useStore } from "@nanostores/react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { ParticipantTile } from "@/components/room/ParticipantTile"
import { $pipWindow, closePip } from "@/stores/pip"

/**
 * The other participants, portaled into the Document PiP window. A portal
 * (not a separate React root) keeps the tiles inside the LiveKit room
 * context, so useTracks/VideoTrack keep working even though the DOM lives
 * in another window.
 *
 * Sticky, single-speaker view (#228): shows one tile, switching to whoever
 * is currently talking. `lastSpeakerIdentity` holds on the most recent
 * speaker through silence instead of falling back to a fixed participant
 * every time the room goes quiet.
 */
export function PipParticipants({
  tracks,
}: {
  tracks: TrackReferenceOrPlaceholder[]
}) {
  const pip = useStore($pipWindow)
  const speaking = useSpeakingParticipants()
  const [lastSpeakerIdentity, setLastSpeakerIdentity] = useState<string | null>(
    null,
  )
  // Leaving the meeting takes the pop-out with it.
  useEffect(() => closePip, [])

  const currentSpeaker = speaking
    .map((p) => tracks.find((t) => t.participant.identity === p.identity))
    .find((t): t is TrackReferenceOrPlaceholder => t !== undefined)
  useEffect(() => {
    if (currentSpeaker)
      setLastSpeakerIdentity(currentSpeaker.participant.identity)
  }, [currentSpeaker])

  const sticky =
    currentSpeaker ??
    tracks.find((t) => t.participant.identity === lastSpeakerIdentity) ??
    tracks[0]

  if (!pip) return null
  return createPortal(
    <div className="flex min-h-dvh flex-col bg-base-200 p-2">
      {!sticky && (
        <p className="m-auto text-base-content/60 text-sm">
          No one else is here yet.
        </p>
      )}
      {sticky && (
        <ParticipantTile key={sticky.participant.identity} trackRef={sticky} />
      )}
    </div>,
    pip.document.body,
  )
}
