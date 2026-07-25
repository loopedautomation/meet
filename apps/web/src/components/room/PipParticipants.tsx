"use client"

import type { TrackReferenceOrPlaceholder } from "@livekit/components-react"
import { useStore } from "@nanostores/react"
import { useEffect } from "react"
import { createPortal } from "react-dom"
import { ParticipantTile } from "@/components/room/ParticipantTile"
import { $pipWindow, closePip } from "@/stores/pip"

/**
 * The other participants, portaled into the Document PiP window. A portal
 * (not a separate React root) keeps the tiles inside the LiveKit room
 * context, so useTracks/VideoTrack keep working even though the DOM lives
 * in another window.
 */
export function PipParticipants({
  tracks,
}: {
  tracks: TrackReferenceOrPlaceholder[]
}) {
  const pip = useStore($pipWindow)
  // Leaving the meeting takes the pop-out with it.
  useEffect(() => closePip, [])
  if (!pip) return null
  return createPortal(
    <div className="flex min-h-dvh flex-col gap-2 bg-base-200 p-2">
      {tracks.length === 0 && (
        <p className="m-auto text-base-content/60 text-sm">
          No one else is here yet.
        </p>
      )}
      {tracks.map((trackRef) => (
        <ParticipantTile
          key={trackRef.participant.identity}
          trackRef={trackRef}
          compact
        />
      ))}
    </div>,
    pip.document.body,
  )
}
