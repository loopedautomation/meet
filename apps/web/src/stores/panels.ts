import { atom } from "nanostores"
import { track } from "@/lib/analytics"
import { $canvasOpen, $canvasUnseen } from "@/stores/canvas"

export type Panel =
  | "agents"
  | "doc"
  | "transcript"
  | "chat"
  | "participants"
  | "settings"
  | "review"
  | null

export const $openPanel = atom<Panel>(null)

/** Whether the meeting doc owns the local stage (like the whiteboard does). */
export const $docOnStage = atom<boolean>(false)

/** Whether the review diff owns the stage. Mutually exclusive with doc and whiteboard. */
export const $reviewOnStage = atom<boolean>(false)

/**
 * Below Tailwind's `md` the side panel renders as a full-screen overlay
 * (PanelHost), so the doc panel and the whiteboard can never actually be
 * seen together — treat them as mutually exclusive there.
 */
const panelOverlaysStage = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 767px)").matches

export function togglePanel(panel: Exclude<Panel, null>) {
  const opening = $openPanel.get() !== panel
  // The doc lives in one place at a time — opening the panel pulls it off
  // the stage rather than mounting a second editor.
  if (opening) track("panel_opened", { panel })
  if (panel === "doc" && opening) {
    $docOnStage.set(false)
    $reviewOnStage.set(false)
    if (panelOverlaysStage()) $canvasOpen.set(false)
    track("doc_panel_opened")
  }
  if (panel === "review" && opening) {
    $reviewOnStage.set(false)
    if (panelOverlaysStage()) $canvasOpen.set(false)
  }
  $openPanel.set(opening ? panel : null)
}

export function openWhiteboard() {
  $canvasOpen.set(true)
  $canvasUnseen.set(false)
  // The stage holds one takeover at a time.
  $docOnStage.set(false)
  $reviewOnStage.set(false)
  $reviewOnStage.set(false)
  // On phones the doc panel would cover the whiteboard entirely — switch.
  if (panelOverlaysStage() && $openPanel.get() === "doc") $openPanel.set(null)
  if (panelOverlaysStage() && $openPanel.get() === "review") $openPanel.set(null)
  track("whiteboard_opened")
}

export function openReviewOnStage() {
  $reviewOnStage.set(true)
  $docOnStage.set(false)
  $canvasOpen.set(false)
  if (panelOverlaysStage() && $openPanel.get() === "review") $openPanel.set(null)
  if (panelOverlaysStage() && $openPanel.get() === "doc") $openPanel.set(null)
}

export function toggleWhiteboard() {
  if ($canvasOpen.get()) $canvasOpen.set(false)
  else openWhiteboard()
}
