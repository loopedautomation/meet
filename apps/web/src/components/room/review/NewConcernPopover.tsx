"use client"
import type { ConcernAnchor } from "@meet/shared/review"
import { useState } from "react"
import { toast } from "react-toastify"
import { useReviewOps } from "@/hooks/useReviewOps"

export function NewConcernPopover({
  slug,
  anchor,
  onClose,
}: {
  slug: string
  anchor: ConcernAnchor
  onClose: () => void
}) {
  const { postOp } = useReviewOps(slug)
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!body.trim()) return
    setBusy(true)
    const res = await postOp({
      op: "raise-concern",
      id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      anchor,
      body: body.trim(),
    })
    setBusy(false)
    if (res.ok) onClose()
    else toast.error(res.error ?? "could not raise the concern")
  }

  return (
    <div className="space-y-2 rounded border border-base-300 bg-base-100 p-3 shadow-xl">
      <p className="font-semibold text-xs">
        Raise concern at {anchor.path}:{anchor.line}
        {anchor.endLine ? `-${anchor.endLine}` : ""}
      </p>
      <textarea
        className="textarea textarea-bordered w-full text-xs"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit()
        }}
        placeholder="What worries you about this change?"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-xs"
          disabled={busy || !body.trim()}
          onClick={submit}
        >
          {busy ? "…" : "Raise concern"}
        </button>
      </div>
    </div>
  )
}
