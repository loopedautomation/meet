"use client"

import { useTranscriptions } from "@livekit/components-react"

export function TranscriptPanel() {
  const transcriptions = useTranscriptions()

  if (transcriptions.length === 0) {
    return (
      <p className="p-4 text-base-content/50 text-sm">
        Live transcript appears here once an agent is in the meeting.
      </p>
    )
  }

  return (
    <ul className="space-y-2 p-4">
      {transcriptions.map((t) => (
        <li key={t.streamInfo.id} className="text-sm">
          <span className="font-medium">
            {t.participantInfo?.identity ?? "unknown"}
          </span>
          <p className="text-base-content/80">{t.text}</p>
        </li>
      ))}
    </ul>
  )
}
