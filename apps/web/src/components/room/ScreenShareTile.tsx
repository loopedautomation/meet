"use client"

import { type TrackReference, VideoTrack } from "@livekit/components-react"

export function ScreenShareTile({ trackRef }: { trackRef: TrackReference }) {
  return (
    <div className="relative size-full overflow-hidden rounded-box bg-base-300">
      <VideoTrack trackRef={trackRef} className="size-full object-contain" />
      <span className="absolute bottom-2 left-2 badge badge-neutral badge-sm bg-base-100/80 text-base-content backdrop-blur">
        {trackRef.participant.name || trackRef.participant.identity} is
        presenting
      </span>
    </div>
  )
}
