"use client"

import { useMediaDeviceSelect } from "@livekit/components-react"
import type { RoomSettings } from "@meet/shared"
import { useStore } from "@nanostores/react"
import { Check, ChevronDown, Lock, Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "react-toastify"
import { useAgentPermissions } from "@/hooks/useRoomSettings"
import { supportsVoiceIsolation } from "@/hooks/useVoiceIsolation"
import { readHostKey } from "@/lib/hostKey"
import { $blur, setBlur } from "@/stores/blur"
import {
  $pauseCameraOnBackground,
  setPauseCameraOnBackground,
} from "@/stores/camera"
import { $theme, setTheme } from "@/stores/theme"
import { $voiceIsolation, setVoiceIsolation } from "@/stores/voiceIsolation"

export function SettingsPanel({ slug }: { slug: string }) {
  const theme = useStore($theme)
  const blur = useStore($blur)
  const voiceIsolation = useStore($voiceIsolation)
  const pauseOnBackground = useStore($pauseCameraOnBackground)

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-base-content/60 text-xs uppercase tracking-wide">
          Appearance
        </h3>
        <div className="join w-full">
          <button
            type="button"
            className={`btn join-item flex-1 ${theme === "looped-light" ? "btn-primary" : "btn-neutral"}`}
            onClick={() => setTheme("looped-light")}
          >
            <Sun className="size-4" />
            Light
          </button>
          <button
            type="button"
            className={`btn join-item flex-1 ${theme === "looped-dark" ? "btn-primary" : "btn-neutral"}`}
            onClick={() => setTheme("looped-dark")}
          >
            <Moon className="size-4" />
            Dark
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium text-base-content/60 text-xs uppercase tracking-wide">
          Devices
        </h3>
        <DeviceSelect
          kind="audioinput"
          label="Microphone"
          persistKey="audioDeviceId"
        />
        <DeviceSelect
          kind="videoinput"
          label="Camera"
          persistKey="videoDeviceId"
        />
        <DeviceSelect
          kind="audiooutput"
          label="Speaker"
          persistKey="audioOutputDeviceId"
        />
      </section>

      {supportsVoiceIsolation() && (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-base-content/60 text-xs uppercase tracking-wide">
            Audio
          </h3>
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span className="flex flex-col">
              <span className="text-sm">Enhanced noise removal</span>
              <span className="text-base-content/60 text-xs">
                Isolates your voice and strips out background noise (fans,
                typing, chatter). On by default — turn it off if it clips your
                audio.
              </span>
            </span>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={voiceIsolation}
              onChange={(e) => setVoiceIsolation(e.target.checked)}
            />
          </label>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-base-content/60 text-xs uppercase tracking-wide">
          Camera effects
        </h3>
        <label className="flex cursor-pointer items-center justify-between">
          <span className="text-sm">Background blur</span>
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={blur}
            onChange={(e) => setBlur(e.target.checked)}
          />
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-base-content/60 text-xs uppercase tracking-wide">
          When you switch away
        </h3>
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="flex flex-col">
            <span className="text-sm">Pause my camera</span>
            <span className="text-base-content/60 text-xs">
              Turns your camera off while this tab is in the background, and
              back on when you return. Off by default — your camera keeps
              running.
            </span>
          </span>
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={pauseOnBackground}
            onChange={(e) => setPauseCameraOnBackground(e.target.checked)}
          />
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-base-content/60 text-xs uppercase tracking-wide">
          Keyboard shortcuts
        </h3>
        <ul className="flex flex-col gap-1 text-sm">
          <li className="flex items-center justify-between">
            <span>Toggle microphone</span>
            <kbd className="kbd kbd-sm">⌘ D</kbd>
          </li>
          <li className="flex items-center justify-between">
            <span>Toggle camera</span>
            <kbd className="kbd kbd-sm">⌘ E</kbd>
          </li>
        </ul>
      </section>

      {/* Everything above is personal — it changes only your own audio, video
          and view. Host-only room controls are cordoned off below, so it's
          clear which settings affect just you and which affect the meeting. */}
      <HostControls slug={slug} />
    </div>
  )
}

// A native <select> can't be reliably truncated cross-browser: neither its
// closed-value text nor its browser/OS-rendered option popup respect CSS
// text-overflow, and on this stack it'll happily render past its own
// `width` for a long device name (confirmed — capping the option text alone
// doesn't stop the closed box itself from overflowing). A DaisyUI dropdown
// gives full control over both, same pattern as the toolbar's own device
// menu (see `DeviceMenu` in ControlBar.tsx), where plain truncation on a
// regular `<span>` just works.
function DeviceSelect({
  kind,
  label,
  persistKey,
}: {
  kind: "audioinput" | "videoinput" | "audiooutput"
  label: string
  persistKey: string
}) {
  const { devices, activeDeviceId, setActiveMediaDevice } =
    useMediaDeviceSelect({ kind })

  if (devices.length === 0) return null

  // activeDeviceId doesn't always match a real deviceId (e.g. video starts
  // as LiveKit's "default" sentinel, which browsers don't expose as an
  // actual camera entry — only audio in/out get a real "default" device).
  // A native <select> in that situation just shows its first <option>
  // rather than going blank; fall back the same way here.
  const activeLabel =
    (devices.find((d) => d.deviceId === activeDeviceId) ?? devices[0])
      .label || label

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-base-content/70 text-sm">{label}</span>
      <div className="dropdown dropdown-bottom w-full">
        <button
          type="button"
          tabIndex={0}
          className="btn btn-sm w-full min-w-0 justify-between border-base-300 bg-base-100 font-normal"
        >
          <span className="min-w-0 truncate">{activeLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
        <ul className="menu dropdown-content z-30 mt-1 w-full max-w-full rounded-box bg-base-100 p-2 shadow-lg">
          {devices.map((d) => (
            <li key={d.deviceId} className="min-w-0">
              <button
                type="button"
                className={d.deviceId === activeDeviceId ? "menu-active" : ""}
                onClick={() => {
                  void setActiveMediaDevice(d.deviceId)
                  try {
                    localStorage.setItem(persistKey, d.deviceId)
                  } catch {}
                }}
              >
                <span className="min-w-0 truncate">{d.label || label}</span>
                {d.deviceId === activeDeviceId && (
                  <Check className="size-4 shrink-0 text-success" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * The organiser's room-level controls, governing what everyone else may do
 * with the meeting's agents. Only the host sees this, and only the host can
 * change it — the toggles write to room metadata through a host-key-
 * authenticated route, which is also what the invite endpoints check, so a
 * locked-down room stays locked down against a crafted request and not just
 * a hidden button.
 */
function HostControls({ slug }: { slug: string }) {
  const { isHost, settings } = useAgentPermissions()
  // Host in the UI is a claim; the key is the evidence the settings route
  // demands. Without it this section can't do anything, so don't show a
  // section whose toggles would only ever error.
  const [hostKey] = useState(() => readHostKey(slug))
  // The saved value lives in room metadata and arrives asynchronously via
  // useRoomInfo. A checkbox bound straight to it snaps back to the old value
  // on click and stays there until the round-trip lands — which reads as a
  // dead toggle. So reflect the intended value immediately and let metadata
  // reconcile it.
  const [pending, setPending] = useState<Partial<RoomSettings>>({})

  // Drop an optimistic value once the room's own metadata confirms it, so the
  // two can't drift and a later real change still shows through.
  useEffect(() => {
    setPending((prev) => {
      const next = { ...prev }
      let changed = false
      for (const key of Object.keys(next) as (keyof RoomSettings)[]) {
        if (settings[key] === next[key]) {
          delete next[key]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [settings])

  if (!isHost || !hostKey) return null

  const effective = { ...settings, ...pending }

  const update = async (key: keyof RoomSettings, value: boolean) => {
    setPending((prev) => ({ ...prev, [key]: value }))
    try {
      const res = await fetch(`/api/rooms/${slug}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { [key]: value }, hostKey }),
      })
      if (!res.ok) throw new Error("save failed")
    } catch {
      // Roll the optimistic value back to whatever the room still says.
      setPending((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      toast.error("Could not save that setting.")
    }
  }

  return (
    <section className="flex flex-col gap-2 border-base-300 border-t pt-5">
      <h3 className="flex items-center gap-1.5 font-medium text-base-content/60 text-xs uppercase tracking-wide">
        <Lock className="size-3" />
        Host controls
      </h3>
      <p className="text-base-content/50 text-xs">
        Only you can see and change these. They apply to everyone else in the
        meeting — you always keep full control of the agents yourself.
      </p>
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-sm">Others can control agents</span>
          <span className="text-base-content/60 text-xs">
            Mute, interrupt, zap and change how agents take turns. Off leaves
            the buttons visible to others but inert.
          </span>
        </span>
        <input
          type="checkbox"
          className="toggle toggle-primary"
          checked={effective.participantsCanControlAgents}
          onChange={(e) =>
            update("participantsCanControlAgents", e.target.checked)
          }
        />
      </label>
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-sm">Others can invite agents</span>
          <span className="text-base-content/60 text-xs">
            Bring agents into the meeting, from the registry or by URL.
          </span>
        </span>
        <input
          type="checkbox"
          className="toggle toggle-primary"
          checked={effective.participantsCanInviteAgents}
          onChange={(e) =>
            update("participantsCanInviteAgents", e.target.checked)
          }
        />
      </label>
    </section>
  )
}
