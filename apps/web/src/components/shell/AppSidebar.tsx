"use client"

import {
  Bot,
  Hash,
  LogOut,
  MessageCircle,
  Plus,
  Settings,
  Shield,
  Volume2,
} from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "react-toastify"
import { StatusEditor } from "@/components/home/StatusEditor"
import { AgentAssign } from "./AgentAssign"
import { DmStart } from "./DmStart"
import { SearchBox } from "./SearchBox"

type Occupant = {
  identity: string
  name: string | null
  kind: string | null
}

export type ChannelRow = {
  slug: string
  name: string
  kind: "voice" | "text"
  topic: string | null
  isPrivate: boolean
  isDm: boolean
  dmPeers: string[]
  unread: boolean
  room: string
  occupants: number
  occupantList: Occupant[]
}

export type SidebarUser = {
  name: string | null
  email: string | null
  image: string | null
  role: "owner" | "admin" | "member"
}

/**
 * The persistent app shell sidebar — Discord-style. Lives in the (app)
 * layout so it survives navigation: the presence SSE connection (which
 * also registers this member as online) stays open while moving between
 * channels, DMs, settings and admin. Slow polling covers SSE gaps.
 */
export function AppSidebar({
  user,
  serverName,
}: {
  user: SidebarUser
  serverName: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const canCreate = user.role !== "member"
  const [channels, setChannels] = useState<ChannelRow[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newSlug, setNewSlug] = useState("")
  const [newKind, setNewKind] = useState<"voice" | "text">("text")
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
        body: JSON.stringify({ slug, kind: newKind }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not create the channel.")
        return
      }
      setNewSlug("")
      setShowCreate(false)
      await load()
      router.push(`/c/${slug}`)
    } finally {
      setCreating(false)
    }
  }

  const regular = channels?.filter((c) => !c.isDm) ?? []
  const dms = channels?.filter((c) => c.isDm) ?? []

  const itemClass = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-sm ${
      active
        ? "bg-base-300/70 font-medium"
        : "text-base-content/80 hover:bg-base-200"
    }`

  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col border-base-300 border-r bg-base-200/40 md:flex">
      {/* Server header */}
      <button
        type="button"
        className="flex items-center justify-between border-base-300 border-b px-4 py-3 text-left hover:bg-base-200"
        onClick={() => router.push("/home")}
      >
        <span className="truncate font-semibold">{serverName}</span>
      </button>

      <div className="px-3 pt-3">
        <SearchBox />
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <div className="flex items-center justify-between px-1 pt-1 pb-1">
          <span className="font-medium text-base-content/50 text-xs uppercase tracking-wide">
            Channels
          </span>
          {canCreate && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              title="Create channel"
              onClick={() => setShowCreate((v) => !v)}
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
        {showCreate && (
          <form onSubmit={create} className="mb-2 flex flex-col gap-2 px-1">
            <div className="flex gap-2">
              <select
                className="select select-xs w-20"
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as "voice" | "text")}
              >
                <option value="text">Text</option>
                <option value="voice">Voice</option>
              </select>
              <input
                className="input input-xs flex-1"
                placeholder="new-channel"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn btn-xs btn-primary"
              disabled={creating || !newSlug.trim()}
            >
              {creating ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                "Create"
              )}
            </button>
          </form>
        )}
        {channels === null ? (
          <span className="loading loading-spinner loading-sm mx-2" />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {regular.length === 0 && (
              <li className="px-2 py-1 text-base-content/50 text-xs">
                No channels yet{canCreate ? " — create one" : ""}
              </li>
            )}
            {regular.map((c) => {
              const active = pathname === `/c/${c.slug}`
              return (
                <li key={c.slug} className="group/item relative">
                  <button
                    type="button"
                    className={itemClass(active)}
                    onClick={() => router.push(`/c/${c.slug}`)}
                  >
                    {c.kind === "voice" ? (
                      <Volume2 className="size-4 shrink-0 text-base-content/50" />
                    ) : (
                      <Hash className="size-4 shrink-0 text-base-content/50" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{c.slug}</span>
                    {c.unread && !active && (
                      <span className="size-2 shrink-0 rounded-full bg-primary" />
                    )}
                    {c.occupants > 0 && (
                      <span className="badge badge-soft badge-primary badge-xs">
                        {c.occupants}
                      </span>
                    )}
                  </button>
                  {canCreate && (
                    <span className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/item:opacity-100">
                      <AgentAssign room={c.room} />
                    </span>
                  )}
                  {c.occupantList.length > 0 && (
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 pb-1 pl-8 text-base-content/50 text-xs">
                      {c.occupantList.map((o) => (
                        <span
                          key={o.identity}
                          className="flex items-center gap-1"
                        >
                          {o.kind === "agent" && <Bot className="size-3" />}
                          {o.name ?? "someone"}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex items-center justify-between px-1 pt-4 pb-1">
          <span className="font-medium text-base-content/50 text-xs uppercase tracking-wide">
            Direct messages
          </span>
          <DmStart />
        </div>
        <ul className="flex flex-col gap-0.5">
          {channels !== null && dms.length === 0 && (
            <li className="px-2 py-1 text-base-content/50 text-xs">
              No conversations yet
            </li>
          )}
          {dms.map((c) => {
            const active = pathname === `/c/${c.slug}`
            return (
              <li key={c.slug}>
                <button
                  type="button"
                  className={itemClass(active)}
                  onClick={() => router.push(`/c/${c.slug}`)}
                >
                  <MessageCircle className="size-4 shrink-0 text-base-content/50" />
                  <span className="min-w-0 flex-1 truncate">
                    {c.dmPeers.join(", ") || "Direct message"}
                  </span>
                  {c.unread && !active && (
                    <span className="size-2 shrink-0 rounded-full bg-primary" />
                  )}
                  {c.occupants > 0 && (
                    <span className="badge badge-soft badge-primary badge-xs">
                      huddling
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* User footer */}
      <div className="border-base-300 border-t bg-base-200/60 px-3 py-2">
        <div className="flex items-center gap-2">
          {user.image ? (
            <img src={user.image} alt="" className="size-8 rounded-full" />
          ) : (
            <span className="flex size-8 items-center justify-center rounded-full bg-base-300 font-medium text-sm">
              {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">
              {user.name ?? user.email ?? "Member"}
            </p>
            <ul className="m-0 list-none p-0">
              <StatusEditor />
            </ul>
          </div>
          <div className="flex shrink-0 items-center">
            {(user.role === "owner" || user.role === "admin") && (
              <a
                href="/admin"
                className="btn btn-ghost btn-xs"
                title="Server admin"
              >
                <Shield className="size-4" />
              </a>
            )}
            <a
              href="/settings"
              className="btn btn-ghost btn-xs"
              title="Settings"
            >
              <Settings className="size-4" />
            </a>
            <a
              href="/auth/logout"
              className="btn btn-ghost btn-xs"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </a>
          </div>
        </div>
      </div>
    </aside>
  )
}
