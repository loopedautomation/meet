"use client"
import { useState } from "react"
import { NewConcernPopover } from "./NewConcernPopover"
import { ConcernThread } from "./ConcernThread"
import { useStore } from "@nanostores/react"
import { $review } from "@/stores/review"

export function ReviewDiffFile({ file, slug }: { file: { path: string; patch?: string }; slug: string }) {
  const review = useStore($review)
  const [showPop, setShowPop] = useState<{ line: number } | null>(null)
  const fileConcerns = (review?.concerns ?? []).filter((c: unknown) => (c as Record<string,unknown>).anchor && ((c as Record<string,unknown>).anchor as Record<string,unknown>).path === file.path) as Array<Record<string,unknown>>
  const patch = (file as Record<string,unknown>).patch as string | undefined
  if (!patch) return <p className="text-xs opacity-50">No diff available (binary or truncated). <a href={String((review?.pr as Record<string,unknown>)?.url ?? "#")} target="_blank" className="link">View on GitHub</a></p>
  const lines = patch.split("\n").slice(0, 400)
  return (
    <div className="space-y-2">
      <pre className="overflow-auto rounded bg-base-200 p-3 text-xs leading-4">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2 hover:bg-base-300 cursor-pointer" onClick={()=>setShowPop({ line: i+1 })}>
            <span className="w-8 shrink-0 text-right opacity-40">{i+1}</span>
            <span className={line.startsWith("+") ? "text-success" : line.startsWith("-") ? "text-error" : ""}>{line}</span>
          </div>
        ))}
      </pre>
      {fileConcerns.map(c => (
        <ConcernThread key={String(c.id)} concern={c as never} slug={slug} />
      ))}
      {showPop ? <NewConcernPopover slug={slug} anchor={{ path: file.path, side: "new" as const, line: showPop.line, sha: String((review?.pr as Record<string,unknown>)?.headSha ?? "") }} onClose={()=>setShowPop(null)} /> : null}
    </div>
  )
}
