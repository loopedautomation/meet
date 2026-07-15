"use client"

import { RoomAudioRenderer, useTracks } from "@livekit/components-react"
import { Track } from "livekit-client"
import { ControlBar } from "@/components/room/ControlBar"
import { ParticipantTile } from "@/components/room/ParticipantTile"
import { PanelHost } from "@/components/room/panels/PanelHost"
import { ScreenShareTile } from "@/components/room/ScreenShareTile"

export function MeetingView({ slug }: { slug: string }) {
  const cameraTracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  )
  const screenTracks = useTracks([Track.Source.ScreenShare], {
    onlySubscribed: true,
  })
  const focused = screenTracks[0]

  return (
    <div className="flex h-dvh flex-col bg-base-200">
      <RoomAudioRenderer />

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {focused ? (
          <>
            <div className="min-w-0 flex-1">
              <ScreenShareTile trackRef={focused} />
            </div>
            <div className="flex w-52 shrink-0 flex-col gap-3 overflow-y-auto">
              {cameraTracks.map((trackRef) => (
                <ParticipantTile
                  key={trackRef.participant.identity}
                  trackRef={trackRef}
                  compact
                />
              ))}
            </div>
          </>
        ) : (
          <div
            className="grid flex-1 content-center gap-3"
            style={{
              gridTemplateColumns: `repeat(${gridColumns(cameraTracks.length)}, minmax(0, 1fr))`,
            }}
          >
            {cameraTracks.map((trackRef) => (
              <ParticipantTile
                key={trackRef.participant.identity}
                trackRef={trackRef}
              />
            ))}
          </div>
        )}
        <PanelHost slug={slug} />
      </div>

      <ControlBar slug={slug} />
    </div>
  )
}

function gridColumns(count: number): number {
  if (count <= 1) return 1
  if (count <= 4) return 2
  if (count <= 9) return 3
  return 4
}
