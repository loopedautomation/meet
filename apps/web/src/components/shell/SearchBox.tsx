"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

type SearchResult = {
  id: string
  slug: string
  author: string
  snippet: string
  at: number
}

/** Message search (Postgres FTS) — results jump to the conversation. */
export function SearchBox() {
  const router = useRouter()
  const [q, setQ] = useState("")
  const [results, setResults] = useState<SearchResult[] | null>(null)

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
        if (!res.ok) return
        const data = (await res.json()) as { results: SearchResult[] }
        setResults(data.results)
      } catch {}
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  return (
    <div className="relative w-full">
      <input
        className="input input-sm w-full"
        placeholder="Search messages…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results !== null && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
          {results.length === 0 ? (
            <p className="px-2 py-1 text-base-content/50 text-xs">
              No matches.
            </p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                className="block w-full rounded-btn px-2 py-1.5 text-left hover:bg-base-200"
                onClick={() => {
                  setQ("")
                  router.push(`/c/${r.slug}`)
                }}
              >
                <span className="block text-base-content/50 text-xs">
                  {r.author} · #{r.slug}
                </span>
                {/* Plain text — ts_headline marks matches with **, never HTML. */}
                <span className="block truncate text-sm">{r.snippet}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
