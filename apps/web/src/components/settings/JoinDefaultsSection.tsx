"use client"

import { useStore } from "@nanostores/react"
import {
  $joinCameraOff,
  $joinMuted,
  setJoinCameraOff,
  setJoinMuted,
} from "@/stores/preferences"

export function JoinDefaultsSection({
  onMutedEnabled,
  onCameraOffEnabled,
}: {
  onMutedEnabled?: () => void
  onCameraOffEnabled?: () => void
}) {
  const joinMuted = useStore($joinMuted)
  const joinCameraOff = useStore($joinCameraOff)

  return (
    <>
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-sm">Always join muted</span>
          <span className="text-base-content/60 text-xs">
            Saved in this browser and applied to every meeting you join here.
          </span>
        </span>
        <input
          type="checkbox"
          className="toggle toggle-primary"
          checked={joinMuted}
          onChange={(e) => {
            setJoinMuted(e.target.checked)
            if (e.target.checked) onMutedEnabled?.()
          }}
        />
      </label>
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-sm">Always join with camera off</span>
          <span className="text-base-content/60 text-xs">
            Saved in this browser and applied to every meeting you join here.
          </span>
        </span>
        <input
          type="checkbox"
          className="toggle toggle-primary"
          checked={joinCameraOff}
          onChange={(e) => {
            setJoinCameraOff(e.target.checked)
            if (e.target.checked) onCameraOffEnabled?.()
          }}
        />
      </label>
    </>
  )
}
