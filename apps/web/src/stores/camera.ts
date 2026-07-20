import { atom } from "nanostores"
import {
  readPauseOnBackgroundPref,
  writePauseOnBackgroundPref,
} from "@/hooks/useAwayOnHidden"

// Whether to pause the local camera while this tab is backgrounded. Default
// off: the camera stays on unless the user explicitly stops it. Toggled from
// the settings panel, read by the useAwayOnHidden mount in MeetingView.
export const $pauseCameraOnBackground = atom<boolean>(
  readPauseOnBackgroundPref(),
)

export function setPauseCameraOnBackground(enabled: boolean) {
  $pauseCameraOnBackground.set(enabled)
  writePauseOnBackgroundPref(enabled)
}
