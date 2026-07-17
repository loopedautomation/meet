"use client"

import { useParticipants, useTranscriptions } from "@livekit/components-react"

export function TranscriptPanel() {
  const transcriptions = useTranscriptions()
  const participants = useParticipants()
  const displayName = (identity?: string) => {
    if (!identity) return "unknown"
    const p = participants.find((p) => p.identity === identity)
    return p?.name || identity
  }

  // Interim updates arrive as separate text streams sharing a segment id;
  // keep only the latest text per segment so a growing utterance updates in
  // place instead of stacking rows.
  const segments = new Map<string, (typeof transcriptions)[number]>()
  for (const t of transcriptions) {
    const key = t.streamInfo.attributes?.["lk.segment_id"] ?? t.streamInfo.id
    segments.set(key, t)
  }
  const entries = [...segments.entries()]

  if (entries.length === 0) {
    return (
      <p className="p-4 text-base-content/50 text-sm">
        The live transcript appears here as people speak.
      </p>
    )
  }

  return (
    <ul className="space-y-2 p-4">
      {entries.map(([key, t]) => (
        <li key={key} className="text-sm">
          <span className="font-medium">
            {displayName(t.participantInfo?.identity)}
          </span>
          <p className="text-base-content/80">{t.text}</p>
        </li>
      ))}
    </ul>
  )
}
