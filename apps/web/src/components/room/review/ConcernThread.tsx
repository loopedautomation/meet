"use client"
import type { Concern } from "@meet/shared/review"

export function ConcernThread({ concern, slug }: { concern: Concern; slug: string }) {
  const statusColor = concern.status==="open" ? "badge-warning" : concern.status==="accepted" ? "badge-info" : concern.status==="resolved" ? "badge-success" : concern.status==="verified" ? "badge-success" : "badge-ghost"
  return (
    <div className="rounded border p-2 text-xs space-y-1">
      <div className="flex items-center gap-2">
        <span className={`badge ${statusColor} badge-sm`}>{concern.status}</span>
        <span className="opacity-60">{concern.raisedBy.name}</span>
        {concern.proposed ? <span className="badge badge-outline badge-xs">proposed</span> : null}
        {concern.anchor ? <span className="opacity-50">{concern.anchor.path}:{concern.anchor.line}</span> : null}
      </div>
      <p>{concern.body}</p>
      {concern.decision ? <p className="opacity-60">Decision by {concern.decision.by.name}: {concern.decision.note}</p> : null}
      {concern.resolution ? <p className="opacity-60">Resolved: {concern.resolution.note}</p> : null}
    </div>
  )
}
