"use client"

import { useLocalParticipant, useRoomContext } from "@livekit/components-react"
import { parseParticipantMeta } from "@meet/shared"
import { RoomEvent } from "livekit-client"
import { useEffect, useState } from "react"
import { Wordmark } from "@/components/brand/BrandMark"
import type { JoinPreferences } from "@/components/room/RoomClient"

/**
 * Shown while this participant sits in the waiting room. Admission arrives as
 * a server-side metadata + permission upgrade; once it lands, media is
 * enabled per the lobby preferences and the parent swaps to the meeting.
 */
export function WaitingRoom({
  prefs,
  onAdmitted,
}: {
  prefs: JoinPreferences
  onAdmitted: () => void
}) {
  const room = useRoomContext()
  const { localParticipant } = useLocalParticipant()
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    const check = async () => {
      const meta = parseParticipantMeta(localParticipant.metadata)
      if (meta?.kind !== "human") return
      // Admitted: bring media up per the lobby toggles, then enter.
      try {
        if (prefs.audioEnabled) {
          await localParticipant.setMicrophoneEnabled(true, {
            deviceId: prefs.audioDeviceId,
          })
        }
        if (prefs.videoEnabled) {
          await localParticipant.setCameraEnabled(true, {
            deviceId: prefs.videoDeviceId,
          })
        }
      } catch {
        // media can fail (permissions); still enter the meeting
      }
      onAdmitted()
    }
    check()
    room.on(RoomEvent.ParticipantMetadataChanged, check)
    room.on(RoomEvent.ParticipantPermissionsChanged, check)
    const onDisconnect = () => setDenied(true)
    room.on(RoomEvent.Disconnected, onDisconnect)
    return () => {
      room.off(RoomEvent.ParticipantMetadataChanged, check)
      room.off(RoomEvent.ParticipantPermissionsChanged, check)
      room.off(RoomEvent.Disconnected, onDisconnect)
    }
  }, [room, localParticipant, prefs, onAdmitted])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <Wordmark />
      {denied ? (
        <p className="text-base-content/70">
          You weren't admitted to this meeting.
        </p>
      ) : (
        <div className="text-center">
          <p className="animate-pulse font-medium text-lg">
            Asking to be let in…
          </p>
          <p className="text-base-content/60 text-sm">
            Someone in the meeting needs to admit you.
          </p>
        </div>
      )}
    </main>
  )
}
