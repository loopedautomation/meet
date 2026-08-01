"use client"

import { Bot, Hash, Plus, Volume2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "react-toastify"

type Occupant = {
  identity: string
  name: string | null
  kind: string | null
}

type ChannelRow = {
  slug: string
  name: string
  kind: "voice" | "text"
  topic: string | null
  isPrivate: boolean
  room: string
  occupants: number
  occupantList: Occupant[]
}

/**
 * The channel sidebar: live occupancy via the presence SSE stream ("3
 * people + Scout in #standup"), with a slow poll as fallback when the
 * stream can't hold. One click joins.
 */
export function ChannelList({ canCreate }: { canCreate: boolean }) {
  const router = useRouter()
  const [channels, setChannels] = useState<ChannelRow[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [newSlug, setNewSlug] = useState("")
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/channels")
      if (!res.ok) return
      const data = (await res.json()) as { channels: ChannelRow[] }
      setChannels(data.channels)
    } catch {}
  }, [])

  useEffect(() => {
    let source: EventSource | null = null
    const startPolling = () => {
      if (pollTimer.current) return
      void load()
      pollTimer.current = setInterval(() => void load(), 15_000)
    }
    try {
      source = new EventSource("/api/presence/stream")
      source.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as { channels: ChannelRow[] }
          setChannels(data.channels)
        } catch {}
      }
      source.onerror = () => {
        // The browser retries SSE on its own; polling covers the gap and
        // stops mattering once events flow again.
        startPolling()
      }
    } catch {
      startPolling()
    }
    return () => {
      source?.close()
      if (pollTimer.current) clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [load])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const slug = newSlug.trim().toLowerCase()
    if (!slug) return
    setCreating(true)
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not create the channel.")
        return
      }
      setNewSlug("")
      await load()
    } finally {
      setCreating(false)
    }
  }

  if (channels === null) {
    return <span className="loading loading-spinner loading-sm" />
  }

  return (
    <div className="w-full max-w-md">
      <ul className="menu w-full rounded-box border border-base-300 bg-base-200/20 p-2">
        {channels.length === 0 && (
          <li className="menu-title">
            No channels yet{canCreate ? " — create one below" : ""}
          </li>
        )}
        {channels.map((c) => (
          <li key={c.slug}>
            <button
              type="button"
              className="flex flex-col items-stretch gap-1"
              onClick={() => router.push(`/c/${c.slug}`)}
            >
              <span className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-medium">
                  {c.kind === "voice" ? (
                    <Volume2 className="size-4 text-base-content/60" />
                  ) : (
                    <Hash className="size-4 text-base-content/60" />
                  )}
                  {c.slug}
                </span>
                {c.occupants > 0 && (
                  <span className="badge badge-soft badge-primary badge-sm">
                    {c.occupants}
                  </span>
                )}
              </span>
              {c.occupantList.length > 0 && (
                <span className="flex flex-wrap gap-x-2 gap-y-0.5 pl-6 text-base-content/60 text-xs">
                  {c.occupantList.map((o) => (
                    <span key={o.identity} className="flex items-center gap-1">
                      {o.kind === "agent" && <Bot className="size-3" />}
                      {o.name ?? "someone"}
                    </span>
                  ))}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {canCreate && (
        <form onSubmit={create} className="mt-3 flex items-center gap-2">
          <input
            className="input input-sm flex-1"
            placeholder="new-channel-name"
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-sm btn-primary"
            disabled={creating || !newSlug.trim()}
          >
            {creating ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <Plus className="size-4" />
            )}
            Create
          </button>
        </form>
      )}
    </div>
  )
}
