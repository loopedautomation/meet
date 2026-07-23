import { atom } from "nanostores"
import type { CameraEffect } from "@/lib/backgrounds"
import { BACKGROUNDS } from "@/lib/backgrounds"

const KEY = "cameraEffect"

function initial(): CameraEffect {
  if (typeof window === "undefined") return "none"
  try {
    const raw = localStorage.getItem(KEY)
    if (
      raw === "blur" ||
      raw === "none" ||
      BACKGROUNDS.some((b) => b.id === raw)
    ) {
      return raw as CameraEffect
    }
    // Migrate the pre-effects blur boolean.
    return localStorage.getItem("backgroundBlur") === "true" ? "blur" : "none"
  } catch {
    return "none"
  }
}

/** What the camera runs through: nothing, blur, or a virtual background. */
export const $cameraEffect = atom<CameraEffect>(initial())

export function setCameraEffect(effect: CameraEffect) {
  $cameraEffect.set(effect)
  try {
    localStorage.setItem(KEY, effect)
  } catch {}
}
