"use client"

import { useLocalParticipant, useParticipants } from "@livekit/components-react"
import { parseParticipantMeta } from "@meet/shared"
import { Bot, Check, User, X } from "lucide-react"
import { useState } from "react"

export function ParticipantsPanel({ slug }: { slug: string }) {
  const participants = useParticipants()
  const { localParticipant } = useLocalParticipant()
  const [busy, setBusy] = useState<string | null>(null)

  const kind = (metadata?: string) => parseParticipantMeta(metadata)?.kind
  const waiting = participants.filter((p) => kind(p.metadata) === "waiting")
  const inMeeting = participants.filter(
    (p) => kind(p.metadata) === "human" || kind(p.metadata) === "agent",
  )

  const decide = async (identity: string, action: "admit" | "deny") => {
    setBusy(identity)
    try {
      await fetch(`/api/rooms/${slug}/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identity,
          action,
          requesterIdentity: localParticipant.identity,
        }),
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {waiting.length > 0 && (
        <>
          <div className="px-4 py-2 font-medium text-base-content/60 text-xs uppercase tracking-wide">
            Waiting to join
          </div>
          <ul className="space-y-2 px-4 pb-2">
            {waiting.map((p) => (
              <li
                key={p.identity}
                className="flex items-center gap-3 rounded-field bg-warning/10 p-3 ring-1 ring-warning/30"
              >
                <User className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium text-sm">
                  {p.name || p.identity}
                </span>
                <button
                  type="button"
                  className="btn btn-success btn-xs"
                  disabled={busy === p.identity}
                  onClick={() => decide(p.identity, "admit")}
                >
                  <Check className="size-3" />
                  Admit
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-error"
                  disabled={busy === p.identity}
                  onClick={() => decide(p.identity, "deny")}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="px-4 py-2 font-medium text-base-content/60 text-xs uppercase tracking-wide">
        In the meeting
      </div>
      <ul className="space-y-1 px-4 pb-4">
        {inMeeting.map((p) => (
          <li
            key={p.identity}
            className="flex items-center gap-3 rounded-field p-2"
          >
            {kind(p.metadata) === "agent" ? (
              <Bot className="size-4 shrink-0 text-primary" />
            ) : (
              <User className="size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm">
              {p.name || p.identity}
              {p.isLocal && " (you)"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
