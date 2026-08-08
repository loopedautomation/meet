"use client"
import { useStore } from "@nanostores/react"
import { $review, $reviewFocus } from "@/stores/review"
import { ReviewFileTree } from "./ReviewFileTree"
import { ReviewDiffFile } from "./ReviewDiffFile"
import { useState } from "react"

export default function ReviewTakeover({ slug, tracks, focused }: { slug: string; tracks?: unknown; focused?: unknown }) {
  const review = useStore($review)
  const focus = useStore($reviewFocus)
  const [selected, setSelected] = useState<string | null>(null)
  if (!review?.pr) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <p className="text-sm opacity-60">No PR loaded. Ask your coding agent to load a PR.</p>
        </div>
      </div>
    )
  }
  const files = (review.pr.files ?? []) as Array<{ path: string; additions: number; deletions: number }>
  const currentFile = files.find(f => f.path === selected) ?? files[0]
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <span className="font-semibold text-sm">{review.pr.repo} #{review.pr.number}</span>
        <span className="text-xs opacity-60">{review.pr.title}</span>
        <span className="ml-auto text-xs opacity-50">{review.pr.headRef}@{review.pr.headSha.slice(0,7)}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 border-r overflow-y-auto">
          <ReviewFileTree files={files} selected={selected ?? currentFile?.path ?? null} onSelect={setSelected} concerns={review.concerns as never} />
        </div>
        <div className="flex-1 overflow-auto p-4">
          {currentFile ? <ReviewDiffFile file={currentFile as never} slug={slug} /> : <p className="text-sm opacity-50">Select a file</p>}
          {focus ? <p className="text-xs opacity-50 mt-2">Focus: {focus.path}:{focus.line}</p> : null}
        </div>
      </div>
    </div>
  )
}
