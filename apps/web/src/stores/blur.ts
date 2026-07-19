import { atom } from "nanostores"
import { readBlurPref, writeBlurPref } from "@/hooks/useBackgroundBlur"

// Shared blur preference: toggled from the settings panel (and the camera
// device menu), applied by the single useBackgroundBlur mount in ControlBar.
export const $blur = atom<boolean>(readBlurPref())

export function setBlur(enabled: boolean) {
  $blur.set(enabled)
  writeBlurPref(enabled)
}
