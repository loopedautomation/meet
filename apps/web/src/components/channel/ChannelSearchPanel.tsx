"use client"

import { Search, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Avatar } from "@/components/ui/Avatar"

type SearchResult = {
  id: string
  author: string
  authorImage: string | null
  snippet: string
  at: number
}

/** Renders a `ts_headline` snippet's `**match**` markers as `<mark>` — the
 * API only ever sends plain text with `**`-delimited markers, never HTML. */
function Snippet({ text }: { text: string }) {
  const parts = text.split("**")
  return (
    <>
      {parts.map((part, i) =>
        // Index keys are safe here — `parts` is a fixed split of one
        // snippet string, never reordered or mutated after render.
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-warning/40 px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

function dayLabel(at: number): string {
  const d = new Date(at)
  const today = new Date()
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return "Today"
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay(d, yesterday)) return "Yesterday"
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  })
}

/**
 * Discord-style search results side panel — channel-scoped Postgres FTS via
 * `/api/channels/[room]/search`, grouped by day, with "load more" pagination.
 * Clicking a result hands the message id up to the caller, which decides
 * whether it's in the currently-loaded scrollback (scroll + highlight) or
 * not (v1: no jump, see TextChannelView).
 */
export function ChannelSearchPanel({
  room,
  onClose,
  onResultClick,
}: {
  room: string
  onClose: () => void
  onResultClick: (id: string) => void
}) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searched, setSearched] = useState(false)
  // Guards against an earlier, slower request clobbering a later one's result.
  const seq = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      seq.current++
      setResults([])
      setHasMore(false)
      setSearched(false)
      setLoading(false)
      return
    }
    const mySeq = ++seq.current
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/channels/${room}/search?q=${encodeURIComponent(query)}`,
        )
        if (mySeq !== seq.current) return
        if (!res.ok) {
          setResults([])
          setHasMore(false)
          setSearched(false)
          return
        }
        const data = (await res.json()) as {
          results: SearchResult[]
          hasMore: boolean
        }
        if (mySeq !== seq.current) return
        setResults(data.results)
        setHasMore(data.hasMore)
        setSearched(true)
      } catch {
        if (mySeq === seq.current) {
          setResults([])
          setHasMore(false)
          setSearched(false)
        }
      } finally {
        if (mySeq === seq.current) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [q, room])

  const loadMore = async () => {
    const query = q.trim()
    if (query.length < 2 || loadingMore) return
    // Same query-generation guard as the debounced search above — if the
    // query changes while this page is in flight, its response must not
    // land on top of a different search's results.
    const mySeq = seq.current
    setLoadingMore(true)
    try {
      const res = await fetch(
        `/api/channels/${room}/search?q=${encodeURIComponent(query)}&offset=${results.length}`,
      )
      if (mySeq !== seq.current || !res.ok) return
      const data = (await res.json()) as {
        results: SearchResult[]
        hasMore: boolean
      }
      if (mySeq !== seq.current) return
      setResults((prev) => [...prev, ...data.results])
      setHasMore(data.hasMore)
    } finally {
      if (mySeq === seq.current) setLoadingMore(false)
    }
  }

  // Results arrive newest-first already; group consecutive same-day runs.
  const groups: { label: string; items: SearchResult[] }[] = []
  for (const r of results) {
    const label = dayLabel(r.at)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(r)
    else groups.push({ label, items: [r] })
  }

  return (
    <aside className="absolute inset-0 z-20 flex flex-col bg-base-100 md:static md:z-auto md:w-80 md:shrink-0 md:border-base-300 md:border-l">
      <div className="flex items-center gap-2 border-base-300 border-b px-3 py-3">
        <Search className="size-4 shrink-0 text-base-content/50" />
        <input
          ref={inputRef}
          className="input input-sm w-full"
          placeholder="Search this channel…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose()
          }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-circle btn-sm shrink-0"
          onClick={onClose}
          aria-label="Close search"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && results.length === 0 ? (
          <div className="flex justify-center py-8">
            <span className="loading loading-spinner loading-sm" />
          </div>
        ) : q.trim().length === 0 ? (
          <p className="px-2 py-4 text-center text-base-content/50 text-xs">
            Search this channel's messages.
          </p>
        ) : q.trim().length === 1 ? (
          <p className="px-2 py-4 text-center text-base-content/50 text-xs">
            Keep typing…
          </p>
        ) : searched && results.length === 0 ? (
          <p className="px-2 py-4 text-center text-base-content/50 text-xs">
            No matches.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-3">
              <p className="px-2 py-1 font-medium text-base-content/40 text-xs uppercase tracking-wide">
                {g.label}
              </p>
              {g.items.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="flex w-full items-start gap-2 rounded-btn px-2 py-2 text-left hover:bg-base-200"
                  onClick={() => onResultClick(r.id)}
                >
                  <Avatar name={r.author} image={r.authorImage} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate font-medium text-xs">
                        {r.author}
                      </span>
                      <span className="shrink-0 text-base-content/40 text-xs">
                        {new Date(r.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <span className="block truncate text-sm">
                      <Snippet text={r.snippet} />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                "Load more"
              )}
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
