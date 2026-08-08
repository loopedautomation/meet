"use client"
import { useStore } from "@nanostores/react"
import { $review } from "@/stores/review"
import { ConcernThread } from "@/components/room/review/ConcernThread"
import { useState } from "react"
import { postReviewOp } from "@/stores/review"

export function ReviewPanel({ slug }: { slug: string }) {
  const review = useStore($review)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [instruction, setInstruction] = useState("")
  const [busy, setBusy] = useState(false)
  if (!review?.pr) return <div className="p-4 text-xs opacity-60">No PR loaded yet.</div>
  const byStatus = (s: string) => (review.concerns as unknown[]).filter((c: unknown) => (c as Record<string,unknown>).status===s) as unknown as Array<Record<string,unknown>>
  const open = byStatus("open")
  const accepted = byStatus("accepted")
  const resolved = byStatus("resolved")
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }
  const dispatch = async () => {
    if (selected.size===0 || !instruction.trim()) return
    setBusy(true)
    const op = { op: "dispatch-revision" as const, id: `r-${Date.now()}`, concernIds: [...selected], instruction, agentId: "local-" }
    // stub agentId - in real flow pick from participants
    const res = await postReviewOp(slug, "", op)
    setBusy(false)
    if (res.ok) { setSelected(new Set()); setInstruction("") }
    else alert(res.error)
  }
  return (
    <div className="space-y-4 p-4 text-xs">
      <div>
        <h3 className="font-semibold">PR #{String((review.pr as Record<string,unknown>).number)} {(review.pr as Record<string,unknown>).title as string}</h3>
        <p className="opacity-60">{String((review.pr as Record<string,unknown>).repo)} @ {(review.pr as Record<string,unknown>).headSha as string}</p>
      </div>
      <section>
        <h4 className="font-semibold">Open ({open.length})</h4>
        {open.map(c=>(
          <div key={String(c.id)} className="flex items-center gap-2 py-1">
            <input type="checkbox" className="checkbox checkbox-xs" checked={selected.has(String(c.id))} onChange={()=>toggle(String(c.id))} />
            <ConcernThread concern={c as never} slug={slug} />
          </div>
        ))}
      </section>
      <section>
        <h4 className="font-semibold">Accepted ({accepted.length})</h4>
        {accepted.map(c=>(
          <div key={String(c.id)} className="flex items-center gap-2 py-1">
            <input type="checkbox" className="checkbox checkbox-xs" checked={selected.has(String(c.id))} onChange={()=>toggle(String(c.id))} />
            <span>{String(c.body)}</span>
          </div>
        ))}
        {accepted.length>0 ? (
          <div className="space-y-2 border-t pt-2 mt-2">
            <textarea className="textarea textarea-bordered w-full" rows={2} value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="Instruction for agent..." />
            <button className="btn btn-primary btn-sm w-full" disabled={busy || selected.size===0} onClick={dispatch}>{busy ? "..." : `Send ${selected.size} to agent`}</button>
          </div>
        ) : null}
      </section>
      <section>
        <h4 className="font-semibold">Revisions ({(review.revisions as unknown[]).length})</h4>
        {(review.revisions as unknown[]).map((r: unknown) => {
          const rev = r as Record<string,unknown>
          return <div key={String(rev.id)} className="rounded border p-2"><span className="font-medium">{String(rev.id)}</span> - {String(rev.status)} <span className="opacity-60">{String(rev.instruction ?? "").slice(0,80)}</span></div>
        })}
      </section>
      <section>
        <h4 className="font-semibold">Resolved ({resolved.length})</h4>
        {resolved.map(c=> <ConcernThread key={String(c.id)} concern={c as never} slug={slug} />)}
      </section>
      <button className="btn btn-outline btn-sm w-full" onClick={async ()=>{
        const summary = `Review summary for PR #${String((review.pr as Record<string,unknown>).number)}: ${open.length} open, ${accepted.length} accepted, ${resolved.length} resolved`
        // dispatch as brain turn via agent - stub
        alert("Post summary to GitHub via agent (stub): " + summary)
      }}>Post summary to GitHub</button>
    </div>
  )
}
