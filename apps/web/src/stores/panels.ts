import { atom } from "nanostores"

export type Panel = "agents" | "transcript" | "chat" | null

export const $openPanel = atom<Panel>(null)

export function togglePanel(panel: Exclude<Panel, null>) {
  $openPanel.set($openPanel.get() === panel ? null : panel)
}
