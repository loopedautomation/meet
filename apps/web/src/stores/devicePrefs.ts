import { atom } from "nanostores"

/**
 * The microphone/camera a user has explicitly chosen, remembered so it stays
 * selected across mutes, device hot-plugs, and future visits.
 *
 * A concrete deviceId is a "pin": useStickyDevices holds LiveKit to it against
 * the OS auto-switching that otherwise moves people off their chosen input when
 * hardware changes. An empty value means "follow the system default" — the
 * deliberate no-pin state, which also covers explicitly choosing the "Default"
 * entry. The keys match those the in-meeting device menu has always written, so
 * a value stored before this store existed still carries over.
 */
export type DeviceKind = "audioinput" | "videoinput"

const STORAGE_KEY: Record<DeviceKind, string> = {
  audioinput: "audioDeviceId",
  videoinput: "videoDeviceId",
}

// LiveKit's device list carries a synthetic "default" entry; treat it, like an
// empty string, as "no pin — follow the OS default".
export function isPinnedDevice(id: string): boolean {
  return id !== "" && id !== "default"
}

function read(kind: DeviceKind): string {
  if (typeof window === "undefined") return ""
  try {
    return localStorage.getItem(STORAGE_KEY[kind]) ?? ""
  } catch {
    return ""
  }
}

export const $audioDeviceId = atom<string>(read("audioinput"))
export const $videoDeviceId = atom<string>(read("videoinput"))

function store(kind: DeviceKind) {
  return kind === "audioinput" ? $audioDeviceId : $videoDeviceId
}

export function readDevicePref(kind: DeviceKind): string {
  return read(kind)
}

/** Record (or, for "" / "default", clear) the user's chosen input device. */
export function setDevicePref(kind: DeviceKind, id: string) {
  const normalized = isPinnedDevice(id) ? id : ""
  store(kind).set(normalized)
  try {
    localStorage.setItem(STORAGE_KEY[kind], normalized)
  } catch {}
}
