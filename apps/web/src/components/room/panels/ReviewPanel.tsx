"use client"
import {
  useDataChannel,
  useLocalParticipant,
  useParticipants,
} from "@livekit/components-react"
import { DataTopic } from "@meet/shared"
import type { Concern, ReviewState } from "@meet/shared/review"
import { useStore } from "@nanostores/react"
import { useState } from "react"
import { toast } from "react-toastify"
import { ConcernThread } from "@/components/room/review/ConcernThread"
import { useReviewOps } from "@/hooks/useReviewOps"
import { $review } from "@/stores/review"

/**
 * The concern ledger: raise → decide → dispatch → verify, grouped by where
 * each concern sits in the loop. Web participants get the full human
 * powers here — only hosting the agent needs the desktop.
 */
export function ReviewPanel({ slug }: { slug: string }) {
  const review = useStore($review)
  const { postOp } = useReviewOps(slug)
  const participants = useParticipants()
  const { localParticipant } = useLocalParticipant()
  const { send: sendChat } = useDataChannel(DataTopic.Chat)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [instruction, setInstruction] = useState("")
  const [agentId, setAgentId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!review?.pr) {
    return (
      <div className="p-4 text-xs opacity-60">
        No PR loaded yet. Connect your coding agent (Agents panel), then ask it
        in chat to load a pull request.
      </div>
    )
  }

  const agents = participants
    .filter((p) => p.identity.startsWith("agent-"))
    .map((p) => ({
      agentId: p.identity.slice("agent-".length),
      name: p.name || p.identity,
    }))
  const chosenAgent = agentId ?? agents[0]?.agentId ?? null

  const byStatus = (status: Concern["status"], proposed?: boolean) =>
    review.concerns.filter(
      (c) => c.status === status && !!c.proposed === !!proposed,
    )
  const proposed = review.concerns.filter((c) => c.proposed)
  const open = byStatus("open")
  const accepted = byStatus("accepted")
  const resolved = byStatus("resolved")
  const verified = byStatus("verified")
  const rejected = byStatus("rejected")
  const dispatchable = accepted.filter((c) => !c.revisionId)
  const activeRevisions = review.revisions.filter(
    (r) => r.status === "dispatched" || r.status === "working",
  )

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const dispatch = async () => {
    const ids = [...selected].filter((id) =>
      dispatchable.some((c) => c.id === id),
    )
    if (ids.length === 0 || !instruction.trim() || !chosenAgent) return
    setBusy(true)
    const res = await postOp({
      op: "dispatch-revision",
      id: `r-${Date.now().toString(36)}`,
      concernIds: ids,
      instruction: instruction.trim(),
      agentId: chosenAgent,
    })
    setBusy(false)
    if (res.ok) {
      setSelected(new Set())
      setInstruction("")
      toast.info("Revision sent to the agent")
    } else toast.error(res.error ?? "dispatch failed")
  }

  const postSummary = () => {
    const agent = agents.find((a) => a.agentId === chosenAgent)
    if (!agent) {
      toast.error("No agent in the room to post the summary")
      return
    }
    const summary = composeSummary(review)
    const text = `@${agent.name} please post this review summary to the PR on GitHub as a comment (use gh):\n\n${summary}`
    void sendChat(
      new TextEncoder().encode(
        JSON.stringify({
          id: `sum-${Date.now().toString(36)}`,
          from: localParticipant?.identity ?? "",
          fromName: localParticipant?.name ?? "someone",
          text,
          at: Date.now(),
        }),
      ),
      { reliable: true },
    )
    toast.info(`Asked ${agent.name} to post the summary`)
  }

  return (
    <div className="space-y-4 p-4 text-xs">
      <div>
        <h3 className="font-semibold">
          PR #{review.pr.number} · {review.pr.title}
        </h3>
        <p className="opacity-60">
          {review.pr.repo} @ {review.pr.headSha.slice(0, 7)}
        </p>
      </div>

      {proposed.length > 0 && (
        <section className="space-y-1">
          <h4 className="font-semibold">
            Proposed by the agent ({proposed.length})
          </h4>
          {proposed.map((c) => (
            <ConcernThread key={c.id} concern={c} slug={slug} />
          ))}
        </section>
      )}

      <section className="space-y-1">
        <h4 className="font-semibold">Open ({open.length})</h4>
        {open.length === 0 && (
          <p className="opacity-50">
            Click a line in the diff to raise a concern.
          </p>
        )}
        {open.map((c) => (
          <ConcernThread key={c.id} concern={c} slug={slug} />
        ))}
      </section>

      <section className="space-y-1">
        <h4 className="font-semibold">Accepted ({accepted.length})</h4>
        {dispatchable.map((c) => (
          <label key={c.id} className="flex items-start gap-2 py-1">
            <input
              type="checkbox"
              className="checkbox checkbox-xs mt-0.5"
              checked={selected.has(c.id)}
              onChange={() => toggle(c.id)}
            />
            <div className="min-w-0 flex-1">
              <ConcernThread concern={c} slug={slug} />
            </div>
          </label>
        ))}
        {accepted
          .filter((c) => c.revisionId)
          .map((c) => (
            <div key={c.id} className="opacity-60">
              <ConcernThread concern={c} slug={slug} />
            </div>
          ))}
        {dispatchable.length > 0 && (
          <div className="space-y-2 border-base-300 border-t pt-2">
            {agents.length === 0 ? (
              <p className="text-warning">
                No agent in the room — connect one to dispatch revisions.
              </p>
            ) : (
              <>
                {agents.length > 1 && (
                  <select
                    className="select select-bordered select-xs w-full"
                    value={chosenAgent ?? ""}
                    onChange={(e) => setAgentId(e.target.value)}
                  >
                    {agents.map((a) => (
                      <option key={a.agentId} value={a.agentId}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
                <textarea
                  className="textarea textarea-bordered w-full"
                  rows={2}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Revision instruction for the agent…"
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm w-full"
                  disabled={
                    busy ||
                    selected.size === 0 ||
                    !instruction.trim() ||
                    !chosenAgent ||
                    activeRevisions.some((r) => r.agentId === chosenAgent)
                  }
                  onClick={dispatch}
                >
                  {busy
                    ? "…"
                    : activeRevisions.some((r) => r.agentId === chosenAgent)
                      ? "Agent is busy with a revision"
                      : `Send ${selected.size || ""} to agent`}
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {review.revisions.length > 0 && (
        <section className="space-y-1">
          <h4 className="font-semibold">
            Revisions ({review.revisions.length})
          </h4>
          {review.revisions.map((r) => (
            <div key={r.id} className="rounded border border-base-300 p-2">
              <div className="flex items-center gap-2">
                <span
                  className={`badge badge-sm ${
                    r.status === "done"
                      ? "badge-success"
                      : r.status === "failed"
                        ? "badge-error"
                        : "badge-info"
                  }`}
                >
                  {r.status}
                </span>
                <span className="truncate opacity-70">{r.instruction}</span>
              </div>
              {r.progress.length > 0 && (
                <p className="mt-1 opacity-50">
                  {r.progress[r.progress.length - 1].note}
                </p>
              )}
              {r.error && <p className="mt-1 text-error">{r.error}</p>}
              {r.status === "failed" && (
                <button
                  type="button"
                  className="btn btn-outline btn-xs mt-1"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    const res = await postOp({
                      op: "dispatch-revision",
                      id: `r-${Date.now().toString(36)}`,
                      concernIds: r.concernIds,
                      instruction: r.instruction,
                      agentId: r.agentId,
                    })
                    setBusy(false)
                    if (!res.ok) toast.error(res.error ?? "retry failed")
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="space-y-1">
        <h4 className="font-semibold">
          Awaiting verification ({resolved.length})
        </h4>
        {resolved.map((c) => (
          <ConcernThread key={c.id} concern={c} slug={slug} />
        ))}
      </section>

      {(verified.length > 0 || rejected.length > 0) && (
        <p className="opacity-50">
          {verified.length} verified · {rejected.length} rejected
        </p>
      )}

      <button
        type="button"
        className="btn btn-outline btn-sm w-full"
        onClick={postSummary}
        disabled={agents.length === 0}
      >
        Post summary to GitHub
      </button>
    </div>
  )
}

function composeSummary(review: ReviewState): string {
  const pr = review.pr
  if (!pr) return ""
  const lines = [
    `## LoopMeet review — PR #${pr.number} ${pr.title}`,
    `Reviewed at \`${pr.headSha.slice(0, 7)}\` on branch \`${pr.headRef}\`.`,
    "",
  ]
  for (const c of review.concerns) {
    if (c.proposed) continue
    const anchor = c.anchor ? ` (\`${c.anchor.path}:${c.anchor.line}\`)` : ""
    lines.push(`- **${c.status}**${anchor} ${c.body}`)
    if (c.decision?.note)
      lines.push(`  - decision (${c.decision.by.name}): ${c.decision.note}`)
    if (c.resolution?.note) lines.push(`  - resolution: ${c.resolution.note}`)
    if (c.verifiedBy) lines.push(`  - verified by ${c.verifiedBy.name}`)
  }
  return lines.join("\n")
}
