"use client"

import { useParticipants, useTranscriptions } from "@livekit/components-react"
import { useStore } from "@nanostores/react"
import { $localSegments } from "@/stores/localTranscript"

export function TranscriptPanel() {
  const transcriptions = useTranscriptions()
  const localSegments = useStore($localSegments)
  const participants = useParticipants()
  const displayName = (identity?: string) => {
    if (!identity) return "unknown"
    const p = participants.find((p) => p.identity === identity)
    return p?.name || identity
  }

  // Interim updates arrive as separate text streams sharing a segment id;
  // keep only the latest text per segment so a growing utterance updates in
  // place instead of stacking rows.
  const segments = new Map<
    string,
    { identity?: string; text: string; at: number }
  >()
  for (const t of transcriptions) {
    const key = t.streamInfo.attributes?.["lk.segment_id"] ?? t.streamInfo.id
    segments.set(key, {
      identity: t.participantInfo?.identity,
      text: t.text,
      at: t.streamInfo.timestamp,
    })
  }
  // Our own in-browser transcription never loops back through LiveKit;
  // merge the locally mirrored segments so the speaker sees themselves.
  for (const seg of Object.values(localSegments)) {
    segments.set(seg.id, { identity: seg.identity, text: seg.text, at: seg.at })
  }
  const entries = [...segments.entries()].sort((a, b) => a[1].at - b[1].at)

  const time = (at: number) =>
    new Date(at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })

  if (entries.length === 0) {
    return (
      <p className="p-4 text-base-content/50 text-sm">
        The live transcript appears here as people speak.
      </p>
    )
  }

  return (
    <div>
      <p className="px-4 pt-3 text-base-content/40 text-xs">
        Transcribed on your device when supported, otherwise on the server —
        audio never leaves your deployment.
      </p>
      <ul className="space-y-2 p-4">
        {entries.map(([key, t]) => (
          <li key={key} className="text-sm">
            <span className="font-medium">{displayName(t.identity)}</span>
            <span className="ml-2 text-base-content/40 text-xs">
              {time(t.at)}
            </span>
            <p className="text-base-content/80">{t.text}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
