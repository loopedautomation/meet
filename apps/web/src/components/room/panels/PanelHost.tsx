"use client"

import { useStore } from "@nanostores/react"
import { Maximize2, X } from "lucide-react"
import { AgentsPanel } from "@/components/room/panels/AgentsPanel"
import { ChatPanel } from "@/components/room/panels/ChatPanel"
import { DocPanel } from "@/components/room/panels/DocPanel"
import { ParticipantsPanel } from "@/components/room/panels/ParticipantsPanel"
import { SettingsPanel } from "@/components/room/panels/SettingsPanel"
import { TranscriptPanel } from "@/components/room/panels/TranscriptPanel"
import { $canvasOpen } from "@/stores/canvas"
import { $docOnStage, $openPanel } from "@/stores/panels"

const titles = {
  agents: "Agents",
  transcript: "Transcript",
  chat: "Chat",
  doc: "Meeting Notes",
  participants: "Participants",
  settings: "Settings",
} as const

export function PanelHost({ slug }: { slug: string }) {
  const openPanel = useStore($openPanel)
  if (!openPanel) return null

  return (
    // Phones: a full-screen overlay above the stage. Desktop: a side column.
    <aside className="absolute inset-0 z-20 flex flex-col bg-base-100 md:static md:z-auto md:w-80 md:shrink-0 md:rounded-box">
      <div className="flex items-center justify-between border-base-300 border-b px-4 py-3">
        <h2 className="font-medium">{titles[openPanel]}</h2>
        <div className="flex items-center gap-1">
          {openPanel === "doc" && (
            <button
              type="button"
              className="btn btn-ghost btn-circle btn-sm"
              onClick={() => {
                // The stage holds one takeover at a time.
                $canvasOpen.set(false)
                $docOnStage.set(true)
                $openPanel.set(null)
              }}
              aria-label="Open on stage"
              title="Open on stage"
            >
              <Maximize2 className="size-4" />
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-sm"
            onClick={() => $openPanel.set(null)}
            aria-label="Close panel"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {openPanel === "agents" && <AgentsPanel slug={slug} />}
        {openPanel === "transcript" && <TranscriptPanel />}
        {openPanel === "chat" && <ChatPanel />}
        {openPanel === "doc" && <DocPanel slug={slug} />}
        {openPanel === "participants" && <ParticipantsPanel slug={slug} />}
        {openPanel === "settings" && <SettingsPanel slug={slug} />}
      </div>
    </aside>
  )
}
