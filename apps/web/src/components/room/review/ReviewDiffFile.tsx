"use client"
import type { Concern, ConcernAnchor, ReviewFile } from "@meet/shared/review"
import { Fragment, useMemo, useState } from "react"
import { ConcernThread } from "./ConcernThread"
import { NewConcernPopover } from "./NewConcernPopover"

/** Hard ceiling on rendered rows; files beyond it show a truncation notice. */
const MAX_ROWS = 2000

type DiffRow = {
  kind: "hunk" | "context" | "add" | "del"
  text: string
  /** Real file line numbers, derived from the hunk headers — NOT the row index. */
  oldLine?: number
  newLine?: number
}

/**
 * Walk the unified patch once, tracking both counters from each
 * `@@ -a,b +c,d @@` header, so every row knows its true old/new line
 * number. Concern anchors and presenter focus depend on these being the
 * numbers `gh`/GitHub would use.
 */
function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLine = 0
  let newLine = 0
  for (const text of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      rows.push({ kind: "hunk", text })
      continue
    }
    if (text.startsWith("+")) {
      rows.push({ kind: "add", text, newLine })
      newLine++
    } else if (text.startsWith("-")) {
      rows.push({ kind: "del", text, oldLine })
      oldLine++
    } else if (text.startsWith("\\")) {
      // "\ No newline at end of file" — display only, no line numbers.
      rows.push({ kind: "hunk", text })
    } else {
      rows.push({ kind: "context", text, oldLine, newLine })
      oldLine++
      newLine++
    }
    if (rows.length >= MAX_ROWS) break
  }
  return rows
}

const rowClass: Record<DiffRow["kind"], string> = {
  hunk: "bg-base-300/60 text-info",
  context: "",
  add: "bg-success/10 text-success",
  del: "bg-error/10 text-error",
}

export function ReviewDiffFile({
  file,
  concerns,
  headSha,
  prUrl,
  slug,
  focusLine,
}: {
  file: ReviewFile
  concerns: Concern[]
  headSha: string
  prUrl?: string
  slug: string
  focusLine?: { line: number; side?: "old" | "new" } | null
}) {
  const [draft, setDraft] = useState<ConcernAnchor | null>(null)
  const rows = useMemo(
    () => (file.patch ? parsePatch(file.patch) : []),
    [file.patch],
  )

  const fileConcerns = concerns.filter((c) => {
    const anchor = c.resolution?.newAnchor ?? c.anchor
    return anchor?.path === file.path
  })
  const concernsAt = (row: DiffRow): Concern[] =>
    fileConcerns.filter((c) => {
      const anchor = c.resolution?.newAnchor ?? c.anchor
      if (!anchor) return false
      return anchor.side === "old"
        ? row.oldLine === anchor.line
        : row.newLine === anchor.line
    })

  if (!file.patch) {
    return (
      <p className="text-xs opacity-60">
        No diff available for {file.path} ({file.status}
        {file.truncated ? ", truncated" : ""}).{" "}
        {prUrl && (
          <a href={prUrl} target="_blank" rel="noreferrer" className="link">
            View on GitHub
          </a>
        )}
      </p>
    )
  }

  const anchorFor = (row: DiffRow): ConcernAnchor | null => {
    if (row.kind === "hunk") return null
    if (row.kind === "del" && row.oldLine)
      return { path: file.path, side: "old", line: row.oldLine, sha: headSha }
    if (row.newLine)
      return { path: file.path, side: "new", line: row.newLine, sha: headSha }
    return null
  }

  return (
    <div className="space-y-2">
      <pre className="overflow-x-auto rounded bg-base-200 p-2 text-xs leading-5">
        {rows.map((row, i) => {
          const rowAnchor = anchorFor(row)
          const anchored = concernsAt(row)
          const isFocus =
            focusLine &&
            (focusLine.side === "old"
              ? row.oldLine === focusLine.line
              : row.newLine === focusLine.line)
          return (
            <Fragment key={`${i}-${row.text.slice(0, 8)}`}>
              <div
                id={
                  row.newLine
                    ? `diff-${file.path}-new-${row.newLine}`
                    : row.oldLine
                      ? `diff-${file.path}-old-${row.oldLine}`
                      : undefined
                }
                className={`flex gap-2 ${rowClass[row.kind]} ${
                  rowAnchor ? "cursor-pointer hover:bg-base-300" : ""
                } ${isFocus ? "ring-1 ring-primary" : ""}`}
                onClick={() => rowAnchor && setDraft(rowAnchor)}
              >
                <span className="w-10 shrink-0 select-none text-right opacity-40">
                  {row.oldLine ?? ""}
                </span>
                <span className="w-10 shrink-0 select-none text-right opacity-40">
                  {row.newLine ?? ""}
                </span>
                <span className="w-3 shrink-0 select-none text-center">
                  {anchored.length > 0 ? (
                    <span className="badge badge-warning badge-xs">
                      {anchored.length}
                    </span>
                  ) : (
                    ""
                  )}
                </span>
                <span className="whitespace-pre">{row.text || " "}</span>
              </div>
              {anchored.map((c) => (
                <div key={c.id} className="my-1 ml-24 max-w-xl font-sans">
                  <ConcernThread concern={c} slug={slug} />
                </div>
              ))}
              {draft &&
                rowAnchor &&
                draft.line === rowAnchor.line &&
                draft.side === rowAnchor.side && (
                  <div className="my-1 ml-24 max-w-xl font-sans">
                    <NewConcernPopover
                      slug={slug}
                      anchor={draft}
                      onClose={() => setDraft(null)}
                    />
                  </div>
                )}
            </Fragment>
          )
        })}
      </pre>
      {(file.truncated || rows.length >= MAX_ROWS) && (
        <p className="text-xs opacity-60">
          Diff truncated.{" "}
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noreferrer" className="link">
              View the full file on GitHub
            </a>
          )}
        </p>
      )}
    </div>
  )
}
