"use client"
import type { PrSnapshot } from "@meet/shared/review"
import { useStore } from "@nanostores/react"
import { useEffect, useState } from "react"
import {
  $review,
  $reviewFocus,
  $reviewSnapshots,
  fetchSnapshot,
} from "@/stores/review"
import { ReviewDiffFile } from "./ReviewDiffFile"
import { ReviewFileTree } from "./ReviewFileTree"

/**
 * The review stage: file tree + diff for the current PR snapshot. The
 * review STATE (ledger + file list) arrives patch-stripped; the patches
 * live in the per-sha snapshot, fetched here on demand and cached by sha
 * (snapshots are immutable per sha).
 */
export default function ReviewTakeover({
  slug,
}: {
  slug: string
  tracks?: unknown
  focused?: unknown
}) {
  const review = useStore($review)
  const focus = useStore($reviewFocus)
  const snapshots = useStore($reviewSnapshots)
  const [selected, setSelected] = useState<string | null>(null)

  const headSha = review?.pr?.headSha
  const snapshot: PrSnapshot | undefined = headSha
    ? snapshots[headSha]
    : undefined

  useEffect(() => {
    if (headSha && !$reviewSnapshots.get()[headSha]) {
      void fetchSnapshot(slug, headSha)
    }
  }, [slug, headSha])

  // Presenter focus: switch to the focused file and scroll to the line.
  useEffect(() => {
    if (!focus) return
    setSelected(focus.path)
    if (focus.line) {
      const id = `diff-${focus.path}-${focus.side ?? "new"}-${focus.line}`
      // Give the diff a frame to mount before scrolling.
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ block: "center" })
      })
    }
  }, [focus])

  if (!review?.pr) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-box border border-base-300 bg-base-100 p-8">
        <div className="max-w-sm text-center">
          <p className="font-semibold text-sm">No pull request loaded</p>
          <p className="mt-2 text-xs opacity-60">
            Connect your coding agent from the Agents panel, then ask it — by
            chat — to load a PR: “load PR 123”.
          </p>
        </div>
      </div>
    )
  }

  const pr = review.pr
  const files =
    snapshot?.files ?? pr.files.map((f) => ({ ...f, patch: undefined }))
  const currentFile = files.find((f) => f.path === selected) ?? files[0]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-box border border-base-300 bg-base-100">
      <div className="flex items-center gap-3 border-base-300 border-b px-4 py-2">
        <span className="font-semibold text-sm">
          {pr.repo} #{pr.number}
        </span>
        <span className="truncate text-xs opacity-60">{pr.title}</span>
        {pr.checks && (
          <span
            className={`badge badge-sm ${
              pr.checks.summary === "passing"
                ? "badge-success"
                : pr.checks.summary === "failing"
                  ? "badge-error"
                  : "badge-ghost"
            }`}
          >
            checks {pr.checks.summary}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs opacity-50">
          {pr.headRef}@{pr.headSha.slice(0, 7)}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-y-auto border-base-300 border-r">
          <ReviewFileTree
            files={files}
            selected={selected ?? currentFile?.path ?? null}
            onSelect={setSelected}
            concerns={review.concerns}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-auto p-3">
          {currentFile ? (
            snapshot ? (
              <ReviewDiffFile
                file={currentFile}
                concerns={review.concerns}
                headSha={pr.headSha}
                prUrl={pr.url}
                slug={slug}
                focusLine={
                  focus && focus.path === currentFile.path && focus.line
                    ? { line: focus.line, side: focus.side }
                    : null
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="loading loading-spinner" />
              </div>
            )
          ) : (
            <p className="text-sm opacity-50">Select a file</p>
          )}
        </div>
      </div>
    </div>
  )
}
