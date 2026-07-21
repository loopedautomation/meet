"use client"

import { useRoomInfo } from "@livekit/components-react"
import { parseRoomSettings, type RoomSettings } from "@meet/shared"
import { useStore } from "@nanostores/react"
import { useMemo } from "react"
import { $isHost } from "@/stores/host"

/**
 * The host's room-level settings, read from room metadata. Metadata rather
 * than a data message because it reaches people who join later, and LiveKit
 * pushes edits to everyone already in the room.
 */
export function useRoomSettings(): RoomSettings {
  const { metadata } = useRoomInfo()
  return useMemo(() => parseRoomSettings(metadata), [metadata])
}

/**
 * What this participant may do with the meeting's agents. The host is never
 * gated by their own settings.
 */
export function useAgentPermissions(): {
  isHost: boolean
  canControl: boolean
  canInvite: boolean
  settings: RoomSettings
} {
  const settings = useRoomSettings()
  const isHost = useStore($isHost)
  return {
    isHost,
    canControl: isHost || settings.participantsCanControlAgents,
    canInvite: isHost || settings.participantsCanInviteAgents,
    settings,
  }
}
