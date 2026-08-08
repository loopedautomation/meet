"use client"
import type { Concern } from "@meet/shared/review"
import { useState } from "react"
import { toast } from "react-toastify"
import { useReviewOps } from "@/hooks/useReviewOps"

const statusBadge: Record<Concern["status"], string> = {
  open: "badge-warning",
  accepted: "badge-info",
  rejected: "badge-ghost",
  resolved: "badge-success",
  verified: "badge-success",
}

/**
 * One concern, with the actions its status allows. Agents propose and
 * execute; humans decide and verify — the store enforces that, this just
 * offers the right buttons: adopt/discard a proposal, accept/reject an
 * open concern, verify a resolved one.
 */
export function ConcernThread({
  concern,
  slug,
  onJumpTo,
}: {
  concern: Concern
  slug: string
  onJumpTo?: (anchor: NonNullable<Concern["anchor"]>) => void
}) {
  const { postOp } = useReviewOps(slug)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const [deciding, setDeciding] = useState<"accepted" | "rejected" | null>(null)

  const run = async (op: Parameters<typeof postOp>[0]) => {
    setBusy(true)
    const res = await postOp(op)
    setBusy(false)
    if (!res.ok) toast.error(res.error ?? "review action failed")
    return res.ok
  }

  const anchor = concern.resolution?.newAnchor ?? concern.anchor

  return (
    <div className="space-y-1 rounded border border-base-300 p-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={`badge badge-sm ${statusBadge[concern.status]}`}>
          {concern.status}
        </span>
        <span className="opacity-60">{concern.raisedBy.name}</span>
        {concern.proposed && (
          <span className="badge badge-outline badge-xs">proposed</span>
        )}
        {anchor && (
          <button
            type="button"
            className="link opacity-60 hover:opacity-100"
            onClick={() => onJumpTo?.(anchor)}
          >
            {anchor.path}:{anchor.line}
          </button>
        )}
      </div>
      <p>{concern.body}</p>
      {concern.decision && (
        <p className="opacity-60">
          {concern.status === "rejected" ? "Rejected" : "Accepted"} by{" "}
          {concern.decision.by.name}
          {concern.decision.note ? `: ${concern.decision.note}` : ""}
        </p>
      )}
      {concern.resolution && (
        <p className="opacity-60">Agent: {concern.resolution.note}</p>
      )}
      {concern.verifiedBy && (
        <p className="opacity-60">Verified by {concern.verifiedBy.name}</p>
      )}

      {/* proposed → a human adopts it into the ledger or discards it */}
      {concern.proposed && (
        <div className="flex gap-1 pt-1">
          <button
            type="button"
            className="btn btn-primary btn-xs"
            disabled={busy}
            onClick={() => run({ op: "adopt-concern", id: concern.id })}
          >
            Adopt
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            onClick={() => run({ op: "discard-concern", id: concern.id })}
          >
            Discard
          </button>
        </div>
      )}

      {/* open → decide */}
      {!concern.proposed && concern.status === "open" && (
        <div className="space-y-1 pt-1">
          {deciding ? (
            <div className="flex items-center gap-1">
              <input
                className="input input-bordered input-xs flex-1"
                placeholder={
                  deciding === "accepted"
                    ? "Why fix it? (optional)"
                    : "Why not? (optional)"
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary btn-xs"
                disabled={busy}
                onClick={async () => {
                  if (
                    await run({
                      op: "decide",
                      id: concern.id,
                      status: deciding,
                      note,
                    })
                  )
                    setDeciding(null)
                }}
              >
                {deciding === "accepted" ? "Accept" : "Reject"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setDeciding(null)}
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex gap-1">
              <button
                type="button"
                className="btn btn-info btn-xs"
                disabled={busy}
                onClick={() => setDeciding("accepted")}
              >
                Accept
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                disabled={busy}
                onClick={() => setDeciding("rejected")}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}

      {/* resolved → the human closes the loop */}
      {concern.status === "resolved" && (
        <div className="flex items-center gap-1 pt-1">
          <button
            type="button"
            className="btn btn-success btn-xs"
            disabled={busy}
            onClick={() => run({ op: "verify", id: concern.id, ok: true })}
          >
            Verify ✓
          </button>
          <input
            className="input input-bordered input-xs flex-1"
            placeholder="What's still wrong?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-warning btn-xs"
            disabled={busy}
            onClick={() =>
              run({
                op: "verify",
                id: concern.id,
                ok: false,
                ...(note ? { note } : {}),
              })
            }
          >
            ✗ Reopen
          </button>
        </div>
      )}
    </div>
  )
}
