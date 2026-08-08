"use client"
export function ReviewFileTree({
  files,
  selected,
  onSelect,
  concerns,
}: {
  files: Array<{ path: string; additions: number; deletions: number }>
  selected: string | null
  onSelect: (path: string) => void
  concerns: Array<{ anchor?: { path: string } }>
}) {
  const concernCounts = new Map<string, number>()
  for (const c of concerns)
    if (c.anchor?.path)
      concernCounts.set(
        c.anchor.path,
        (concernCounts.get(c.anchor.path) ?? 0) + 1,
      )
  return (
    <ul className="menu p-2 text-xs">
      {files.map((f) => (
        <li key={f.path}>
          <button
            type="button"
            className={selected === f.path ? "active" : ""}
            onClick={() => onSelect(f.path)}
          >
            <span className="truncate">{f.path}</span>
            <span className="ml-auto text-[10px] opacity-60">
              +{f.additions} -{f.deletions}
            </span>
            {(concernCounts.get(f.path) ?? 0) > 0 ? (
              <span className="badge badge-warning badge-xs">
                {concernCounts.get(f.path)}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}
