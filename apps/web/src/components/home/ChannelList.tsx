"use client"

import { Hash, Plus, Users, Volume2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { toast } from "react-toastify"

type ChannelRow = {
  slug: string
  name: string
  kind: "voice" | "text"
  topic: string | null
  isPrivate: boolean
  room: string
  occupants: number
}

/**
 * The Phase 0 channel list: deliberately plain — the Phase 1 sidebar with
 * live presence subscriptions replaces it. Occupancy refreshes on a slow
 * poll of the channel list (room_presence-backed).
 */
export function ChannelList({ canCreate }: { canCreate: boolean }) {
  const router = useRouter()
  const [channels, setChannels] = useState<ChannelRow[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [newSlug, setNewSlug] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/channels")
      if (!res.ok) return
      const data = (await res.json()) as { channels: ChannelRow[] }
      setChannels(data.channels)
    } catch {}
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 15_000)
    return () => clearInterval(timer)
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
              className="flex items-center justify-between"
              onClick={() => router.push(`/c/${c.slug}`)}
            >
              <span className="flex items-center gap-2">
                {c.kind === "voice" ? (
                  <Volume2 className="size-4 text-base-content/60" />
                ) : (
                  <Hash className="size-4 text-base-content/60" />
                )}
                {c.slug}
              </span>
              {c.occupants > 0 && (
                <span className="badge badge-soft badge-primary badge-sm gap-1">
                  <Users className="size-3" />
                  {c.occupants}
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
