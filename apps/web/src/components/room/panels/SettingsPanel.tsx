"use client"

import { useMediaDeviceSelect } from "@livekit/components-react"
import { useStore } from "@nanostores/react"
import { Moon, Sun } from "lucide-react"
import { $blur, setBlur } from "@/stores/blur"
import { $theme, setTheme } from "@/stores/theme"

export function SettingsPanel() {
  const theme = useStore($theme)
  const blur = useStore($blur)

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
    </div>
  )
}

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

  return (
    <label className="flex flex-col gap-1">
      <span className="text-base-content/70 text-sm">{label}</span>
      <select
        className="select select-sm w-full"
        value={activeDeviceId}
        onChange={(e) => {
          void setActiveMediaDevice(e.target.value)
          try {
            localStorage.setItem(persistKey, e.target.value)
          } catch {}
        }}
      >
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || label}
          </option>
        ))}
      </select>
    </label>
  )
}
