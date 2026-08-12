"use client"

import { Mic, MicOff, Video as VideoIcon, VideoOff } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "react-toastify"
import { Wordmark } from "@/components/brand/BrandMark"
import { ThemeToggle } from "@/components/brand/ThemeToggle"
import type { JoinPreferences } from "@/components/room/RoomClient"
import { JoinDefaultsSection } from "@/components/settings/JoinDefaultsSection"
import { Modal } from "@/components/ui/Modal"
import { Select } from "@/components/ui/Select"
import { useMediaPreview } from "@/hooks/useMediaPreview"
import { usePreferencesShortcut } from "@/hooks/usePreferencesShortcut"
import { cleanDeviceLabel } from "@/lib/deviceLabel"
import {
  type DeviceKind,
  readDevicePref,
  setDevicePref,
} from "@/stores/devicePrefs"
import { $joinCameraOff, $joinMuted } from "@/stores/preferences"

function readStoredString(key: string): string {
  if (typeof window === "undefined") return ""
  try {
    return localStorage.getItem(key) ?? ""
  } catch {
    return ""
  }
}

function readStoredToggle(key: string): boolean {
  if (typeof window === "undefined") return true
  try {
    return localStorage.getItem(key) !== "false"
  } catch {
    return true
  }
}

type LobbyProps = {
  slug: string
  onJoin: (prefs: JoinPreferences) => Promise<void>
}

export function Lobby({ slug, onJoin }: LobbyProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [displayName, setDisplayName] = useState("")
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
  // Stored prefs are read after mount so SSR and first client render agree.
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    const stored = readStoredString("displayName")
    setDisplayName(stored)
    // Signed-in members shouldn't retype their name — prefill from the
    // account when nothing was stored (a typed name still wins next time).
    if (!stored) {
      void fetch("/api/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const accountName = d?.user?.name ?? d?.user?.email
          if (accountName) {
            setDisplayName((current) => current || accountName)
          }
        })
        .catch(() => {})
    }
    // "Always join muted / camera off" beats last call's state.
    setAudioEnabled($joinMuted.get() ? false : readStoredToggle("audioEnabled"))
    setVideoEnabled(
      $joinCameraOff.get() ? false : readStoredToggle("videoEnabled"),
    )
    setRestored(true)
  }, [])
  useEffect(() => {
    if (!restored) return
    try {
      localStorage.setItem("audioEnabled", String(audioEnabled))
      localStorage.setItem("videoEnabled", String(videoEnabled))
    } catch {}
  }, [restored, audioEnabled, videoEnabled])
  const [audioDeviceId, setAudioDeviceId] = useState<string>()
  const [videoDeviceId, setVideoDeviceId] = useState<string>()
  const [joining, setJoining] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  usePreferencesShortcut(useCallback(() => setPreferencesOpen(true), []))

  const { mics, cameras, mediaError, stopStream } = useMediaPreview({
    audioEnabled,
    videoEnabled,
    audioDeviceId,
    videoDeviceId,
    videoRef,
  })

  // Restore a previously chosen device — but only once it's confirmed present,
  // so a stale id (a device since unplugged) can't fail the preview's exact
  // getUserMedia. The initial acquire runs on the OS default; this switches to
  // the saved device after enumeration. Runs once per kind, when its list lands.
  const audioRestored = useRef(false)
  const videoRestored = useRef(false)
  useEffect(() => {
    if (!audioRestored.current && mics.length > 0) {
      const saved = readDevicePref("audioinput")
      if (saved && mics.some((m) => m.deviceId === saved)) {
        setAudioDeviceId(saved)
      }
      audioRestored.current = true
    }
    if (!videoRestored.current && cameras.length > 0) {
      const saved = readDevicePref("videoinput")
      if (saved && cameras.some((c) => c.deviceId === saved)) {
        setVideoDeviceId(saved)
      }
      videoRestored.current = true
    }
  }, [mics, cameras])

  useEffect(() => {
    if (mediaError) toast.error(mediaError)
  }, [mediaError])

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!displayName.trim()) return
    setJoining(true)
    try {
      localStorage.setItem("displayName", displayName.trim())
    } catch {}
    stopStream()
    await onJoin({
      displayName: displayName.trim(),
      audioEnabled,
      videoEnabled,
      audioDeviceId,
      videoDeviceId,
    })
    setJoining(false)
  }

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Wordmark />
        <ThemeToggle />
      </header>
      <LobbyPreferencesModal
        isOpen={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        onJoinMutedEnabled={() => setAudioEnabled(false)}
        onJoinCameraOffEnabled={() => setVideoEnabled(false)}
      />

      <div className="grid flex-1 content-center gap-8 pb-16 lg:grid-cols-2">
        <div className="relative aspect-video overflow-hidden rounded-box bg-base-300">
          {videoEnabled ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="size-full scale-x-[-1] object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-base-content/50">
              Camera off
            </div>
          )}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
            <button
              type="button"
              className="btn btn-circle btn-neutral"
              onClick={() => setAudioEnabled((v) => !v)}
              aria-label={
                audioEnabled ? "Mute microphone" : "Unmute microphone"
              }
            >
              {audioEnabled ? (
                <Mic className="size-5" />
              ) : (
                <MicOff className="size-5" />
              )}
            </button>
            <button
              type="button"
              className="btn btn-circle btn-neutral"
              onClick={() => setVideoEnabled((v) => !v)}
              aria-label={videoEnabled ? "Turn camera off" : "Turn camera on"}
            >
              {videoEnabled ? (
                <VideoIcon className="size-5" />
              ) : (
                <VideoOff className="size-5" />
              )}
            </button>
          </div>
        </div>

        <form
          onSubmit={handleJoin}
          className="flex flex-col justify-center gap-4"
        >
          <div>
            <h1 className="font-semibold text-2xl tracking-tight">
              Ready to join?
            </h1>
            <p className="text-base-content/60 text-sm">
              Meeting <span className="font-mono">{slug}</span>
            </p>
          </div>

          <input
            className="input input-lg w-full"
            placeholder="Your name"
            value={displayName}
            maxLength={64}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <DeviceSelectField
            kind="audioinput"
            label="Microphone"
            placeholder="Default microphone"
            devices={mics}
            value={audioDeviceId}
            onChange={setAudioDeviceId}
          />

          <DeviceSelectField
            kind="videoinput"
            label="Camera"
            placeholder="Default camera"
            devices={cameras}
            value={videoDeviceId}
            onChange={setVideoDeviceId}
          />

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={!displayName.trim() || joining}
          >
            {joining && <span className="loading loading-spinner loading-sm" />}
            Join meeting
          </button>
        </form>
      </div>
    </main>
  )
}

type DeviceOption = Pick<MediaDeviceInfo, "deviceId" | "label">

function DeviceSelectField({
  kind,
  label,
  placeholder,
  devices,
  value,
  onChange,
}: {
  kind: DeviceKind
  label: string
  placeholder: string
  devices: readonly DeviceOption[]
  value?: string
  onChange: (value: string | undefined) => void
}) {
  if (devices.length === 0) return null

  return (
    <div className="form-control w-full">
      <span className="label-text pb-1 text-xs">{label}</span>
      <Select
        aria-label={label}
        size="md"
        value={value ?? ""}
        onChange={(e) => {
          const id = e.target.value || undefined
          onChange(id)
          setDevicePref(kind, id ?? "")
        }}
        placeholder={placeholder}
        options={devices.map((d) => ({
          value: d.deviceId,
          label: cleanDeviceLabel(d.label) || label,
        }))}
      />
    </div>
  )
}

function LobbyPreferencesModal({
  isOpen,
  onClose,
  onJoinMutedEnabled,
  onJoinCameraOffEnabled,
}: {
  isOpen: boolean
  onClose: () => void
  onJoinMutedEnabled: () => void
  onJoinCameraOffEnabled: () => void
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-lg">Preferences</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onClose}
          >
            Done
          </button>
        </div>

        <section className="flex flex-col gap-3">
          <h3 className="font-medium text-base-content/60 text-xs uppercase tracking-wide">
            Meeting
          </h3>
          <JoinDefaultsSection
            onMutedEnabled={onJoinMutedEnabled}
            onCameraOffEnabled={onJoinCameraOffEnabled}
          />
        </section>
      </div>
    </Modal>
  )
}
