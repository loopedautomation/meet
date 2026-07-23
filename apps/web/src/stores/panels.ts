import { atom } from "nanostores"

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
  if (panel === "doc" && opening) $docOnStage.set(false)
  $openPanel.set(opening ? panel : null)
}
