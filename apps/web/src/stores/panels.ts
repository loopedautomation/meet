import { atom } from "nanostores"
import { track } from "@/lib/analytics"

export type Panel =
  | "agents"
  | "doc"
  | "transcript"
  | "chat"
  | "participants"
  | "settings"
  | null

export const $openPanel = atom<Panel>(null)

/** Whether the meeting doc owns the local stage (like the whiteboard does). */
export const $docOnStage = atom<boolean>(false)

export function togglePanel(panel: Exclude<Panel, null>) {
  const opening = $openPanel.get() !== panel
  // The doc lives in one place at a time — opening the panel pulls it off
  // the stage rather than mounting a second editor.
  if (opening) track("panel_opened", { panel })
  if (panel === "doc" && opening) {
    $docOnStage.set(false)
    track("doc_panel_opened")
  }
  $openPanel.set(opening ? panel : null)
}
