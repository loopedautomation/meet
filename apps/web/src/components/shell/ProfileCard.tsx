"use client"

import { useStore } from "@nanostores/react"
import { LogOut, Settings } from "lucide-react"
import { useEffect, useState } from "react"
import { Select } from "@/components/ui/Select"
import { cleanDeviceLabel } from "@/lib/deviceLabel"
import { readDevicePref, setDevicePref } from "@/stores/devicePrefs"
import {
  $joinCameraOff,
  $joinMuted,
  setJoinCameraOff,
  setJoinMuted,
} from "@/stores/preferences"

export type Presence = "active" | "away" | "dnd"

export const PRESENCE_DOT: Record<Presence, string> = {
  active: "bg-success",
  away: "bg-warning",
  dnd: "bg-error",
}

const PRESENCE_LABEL: Record<Presence, string> = {
  active: "Active",
  away: "Away",
  dnd: "Do not disturb",
}

type ProfileUser = {
  name: string | null
  email: string | null
  image: string | null
  presence: Presence
}

/**
 * The bottom-left profile card: your presence, your call defaults (mic/cam
 * device and join-muted/camera-off), your settings, your sign-out. Server-
 * level actions live in the server menu at the top of the sidebar.
 */
export function ProfileCard({ user }: { user: ProfileUser }) {
  const [presence, setPresence] = useState<Presence>(user.presence)
  const joinMuted = useStore($joinMuted)
  const joinCameraOff = useStore($joinCameraOff)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [audioDeviceId, setAudioDeviceId] = useState(
    () => readDevicePref("audioinput") ?? "",
  )
  const [videoDeviceId, setVideoDeviceId] = useState(
    () => readDevicePref("videoinput") ?? "",
  )

  // Device labels are only available once the browser has media permission
  // (granted on the first call); enumerate lazily when the menu opens.
  const loadDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setMics(devices.filter((d) => d.kind === "audioinput" && d.deviceId))
      setCameras(devices.filter((d) => d.kind === "videoinput" && d.deviceId))
    } catch {}
  }

  const savePresence = async (next: Presence) => {
    setPresence(next)
    await fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presence: next }),
    }).catch(() => {})
  }

  useEffect(() => {
    setPresence(user.presence)
  }, [user.presence])

  return (
    <div className="dropdown dropdown-top w-full">
      <button
        type="button"
        tabIndex={0}
        className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left hover:bg-base-200"
        onFocus={() => void loadDevices()}
      >
        <span className="relative shrink-0">
          {user.image ? (
            <img src={user.image} alt="" className="size-9 rounded-full" />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-full bg-base-300 font-medium">
              {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
            </span>
          )}
          <span
            className={`absolute right-0 bottom-0 size-3 rounded-full border-2 border-base-200 ${PRESENCE_DOT[presence]}`}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">
            {user.name ?? user.email ?? "Member"}
          </span>
          <span className="block text-base-content/50 text-xs">
            {PRESENCE_LABEL[presence]}
          </span>
        </span>
      </button>

      <div className="dropdown-content z-20 mb-2 w-64 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg">
        <p className="pb-1 font-medium text-base-content/50 text-xs uppercase tracking-wide">
          Status
        </p>
        <div className="flex flex-col">
          {(Object.keys(PRESENCE_LABEL) as Presence[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`flex items-center gap-2 rounded-btn px-2 py-1.5 text-left text-sm hover:bg-base-200 ${
                presence === p ? "font-medium" : ""
              }`}
              onClick={() => void savePresence(p)}
            >
              <span className={`size-2.5 rounded-full ${PRESENCE_DOT[p]}`} />
              {PRESENCE_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="divider my-1" />
        <p className="pb-1 font-medium text-base-content/50 text-xs uppercase tracking-wide">
          Voice & video
        </p>
        <label className="flex items-center justify-between gap-2 px-2 py-1">
          <span className="text-sm">Join calls muted</span>
          <input
            type="checkbox"
            className="toggle toggle-xs"
            checked={joinMuted}
            onChange={(e) => setJoinMuted(e.target.checked)}
          />
        </label>
        <label className="flex items-center justify-between gap-2 px-2 py-1">
          <span className="text-sm">Join with camera off</span>
          <input
            type="checkbox"
            className="toggle toggle-xs"
            checked={joinCameraOff}
            onChange={(e) => setJoinCameraOff(e.target.checked)}
          />
        </label>
        {mics.length > 0 && (
          <label className="block px-2 py-1">
            <span className="block pb-1 text-base-content/60 text-xs">
              Microphone
            </span>
            <Select
              size="sm"
              value={audioDeviceId}
              onChange={(e) => {
                setAudioDeviceId(e.target.value)
                setDevicePref("audioinput", e.target.value)
              }}
              placeholder="Default microphone"
              options={mics.map((d) => ({
                value: d.deviceId,
                label: cleanDeviceLabel(d.label) || "Microphone",
              }))}
            />
          </label>
        )}
        {cameras.length > 0 && (
          <label className="block px-2 py-1">
            <span className="block pb-1 text-base-content/60 text-xs">
              Camera
            </span>
            <Select
              size="sm"
              value={videoDeviceId}
              onChange={(e) => {
                setVideoDeviceId(e.target.value)
                setDevicePref("videoinput", e.target.value)
              }}
              placeholder="Default camera"
              options={cameras.map((d) => ({
                value: d.deviceId,
                label: cleanDeviceLabel(d.label) || "Camera",
              }))}
            />
          </label>
        )}

        <div className="divider my-1" />
        <a
          href="/settings"
          className="flex items-center gap-2 rounded-btn px-2 py-1.5 text-sm hover:bg-base-200"
        >
          <Settings className="size-4" />
          Settings
        </a>
        <a
          href="/auth/logout"
          className="flex items-center gap-2 rounded-btn px-2 py-1.5 text-sm hover:bg-base-200"
        >
          <LogOut className="size-4" />
          Sign out
        </a>
      </div>
    </div>
  )
}
