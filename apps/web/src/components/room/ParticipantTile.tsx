"use client"

import {
  isTrackReference,
  type TrackReferenceOrPlaceholder,
  useIsMuted,
  useIsSpeaking,
  VideoTrack,
} from "@livekit/components-react"
import { parseParticipantMeta } from "@meet/shared"
import { Track } from "livekit-client"
import { MicOff } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { AgentBadge } from "@/components/room/AgentBadge"

type ParticipantTileProps = {
  trackRef: TrackReferenceOrPlaceholder
  compact?: boolean
}

export function ParticipantTile({ trackRef, compact }: ParticipantTileProps) {
  const { participant } = trackRef
  const speaking = useIsSpeaking(participant)
  const micMuted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
  })
  const meta = parseParticipantMeta(participant.metadata)
  const isAgent = meta?.kind === "agent"
  const name = participant.name || participant.identity
  const hasVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted
  // A phone in portrait publishes a taller-than-wide track; cropping it into
  // a landscape card cuts heads off. Measure the actual video element (the
  // publication's static dimensions are unreliable, and the element fires
  // `resize` when the phone rotates mid-call) and adapt the card (compact)
  // or letterbox within the grid cell.
  const videoRef = useRef<HTMLVideoElement>(null)
  const [portrait, setPortrait] = useState(false)
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const update = () => {
      if (el.videoWidth && el.videoHeight) {
        setPortrait(el.videoHeight > el.videoWidth)
      }
    }
    update()
    el.addEventListener("resize", update)
    el.addEventListener("loadedmetadata", update)
    return () => {
      el.removeEventListener("resize", update)
      el.removeEventListener("loadedmetadata", update)
    }
  }, [hasVideo])

  return (
    <div
      className={`relative overflow-hidden rounded-box transition-shadow ${
        participant.isLocal
          ? "bg-[color-mix(in_oklch,var(--color-primary)_20%,var(--color-base-300))] ring-1 ring-primary/40"
          : "bg-base-300"
      } ${speaking ? "ring-2 ring-primary" : ""} ${
        compact
          ? `${portrait ? "aspect-[9/16]" : "aspect-video"} shrink-0`
          : "size-full min-h-0"
      }`}
    >
      {hasVideo ? (
        <VideoTrack
          ref={videoRef}
          trackRef={trackRef}
          className={`size-full ${portrait && !compact ? "object-contain" : "object-cover"} ${
            participant.isLocal ? "scale-x-[-1]" : ""
          }`}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <div
            className={`flex items-center justify-center rounded-full font-medium ${
              participant.isLocal
                ? "bg-secondary text-secondary-content"
                : "bg-primary text-primary-content"
            } ${compact ? "size-10 text-base" : "size-16 text-2xl"}`}
          >
            {name.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
        <span className="badge badge-neutral badge-sm gap-1 bg-base-100/80 text-base-content backdrop-blur">
          {micMuted && <MicOff className="size-3 text-error" />}
          {participant.isLocal ? `${name} (you)` : name}
        </span>
        {isAgent && meta?.agentId && <AgentBadge participant={participant} />}
      </div>
    </div>
  )
}
