"use client"

import { Bot, Hash, MessageCircle, Plus, Volume2 } from "lucide-react"
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
  isDm: boolean
  dmPeers: string[]
  unread: boolean
  room: string
  occupants: number
  occupantList: Occupant[]
}

type Member = {
  id: string
  name: string | null
  email: string | null
  online: boolean
}

/** Start (or reopen) a DM — pick a teammate, land in the conversation. */
function DmStart() {
  const router = useRouter()
  const [members, setMembers] = useState<Member[] | null>(null)

  const open = async () => {
    try {
      const [membersRes, agentsRes] = await Promise.all([
        fetch("/api/members"),
        fetch("/api/agents/server"),
      ])
      if (membersRes.ok) {
        const data = (await membersRes.json()) as { members: Member[] }
        setMembers(data.members)
      }
      if (agentsRes.ok) {
        const data = (await agentsRes.json()) as {
          agents: { id: string; name: string }[]
        }
        setAgents(data.agents)
      }
    } catch {
      setMembers([])
    }
  }

  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])

  const start = async (body: { userIds: string[] } | { agentId: string }) => {
    const res = await fetch("/api/dms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    if (!res?.ok || !data?.slug) {
      toast.error("Could not open the conversation.")
      return
    }
    router.push(`/c/${data.slug}`)
  }

  return (
    <div className="dropdown dropdown-end" onFocus={() => void open()}>
      <button
        type="button"
        tabIndex={0}
        className="btn btn-ghost btn-xs"
        title="New message"
      >
        <Plus className="size-3.5" />
      </button>
      <div className="dropdown-content z-10 max-h-64 w-52 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow">
        {members === null ? (
          <span className="loading loading-spinner loading-xs mx-2" />
        ) : (
          <>
            {members.length <= 1 && agents.length === 0 && (
              <p className="px-2 text-base-content/50 text-xs">
                No teammates yet — invite someone.
              </p>
            )}
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-btn px-2 py-1 text-left text-sm hover:bg-base-200"
                onClick={() => void start({ userIds: [m.id] })}
              >
                <span
                  className={`size-2 rounded-full ${m.online ? "bg-success" : "bg-base-content/20"}`}
                />
                {m.name ?? m.email ?? "someone"}
              </button>
            ))}
            {agents.length > 0 && (
              <p className="menu-title px-2 pt-1 text-xs">Agents</p>
            )}
            {agents.map((a) => (
              <button
                key={a.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-btn px-2 py-1 text-left text-sm hover:bg-base-200"
                onClick={() => void start({ agentId: a.id })}
              >
                <Bot className="size-3.5 text-base-content/60" />
                {a.name}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

type SearchResult = {
  id: string
  slug: string
  author: string
  snippet: string
  at: number
}

function SearchBox() {
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
    <div className="relative mb-3 w-full">
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

type RosterAgent = { id: string; name?: string }

/** Admin control: which agents live in this channel. Assigned agents are
 * dispatched when the first human joins and parked when it empties. */
function AgentAssign({ room }: { room: string }) {
  const [roster, setRoster] = useState<RosterAgent[] | null>(null)
  const [assigned, setAssigned] = useState<string[]>([])

  const open = async () => {
    try {
      const [rosterRes, assignedRes] = await Promise.all([
        fetch("/api/agents"),
        fetch(`/api/channels/${room}/agents`),
      ])
      const rosterData = await rosterRes.json().catch(() => ({ agents: [] }))
      const assignedData = await assignedRes
        .json()
        .catch(() => ({ agents: [] }))
      setRoster(
        (rosterData.agents ?? []).map((a: RosterAgent | string) =>
          typeof a === "string" ? { id: a } : a,
        ),
      )
      setAssigned(assignedData.agents ?? [])
    } catch {
      setRoster([])
    }
  }

  const toggle = async (agentId: string) => {
    const isAssigned = assigned.includes(agentId)
    setAssigned((prev) =>
      isAssigned ? prev.filter((a) => a !== agentId) : [...prev, agentId],
    )
    const res = await fetch(`/api/channels/${room}/agents`, {
      method: isAssigned ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId }),
    }).catch(() => null)
    if (!res?.ok) {
      toast.error("Could not update the channel's agents.")
      setAssigned((prev) =>
        isAssigned ? [...prev, agentId] : prev.filter((a) => a !== agentId),
      )
    }
  }

  return (
    <div className="dropdown dropdown-end" onFocus={() => void open()}>
      <button
        type="button"
        tabIndex={0}
        className="btn btn-ghost btn-xs"
        title="Channel agents"
        onClick={(e) => e.stopPropagation()}
      >
        <Bot className="size-3.5" />
      </button>
      <div className="dropdown-content z-10 w-52 rounded-box border border-base-300 bg-base-100 p-2 shadow">
        <p className="px-2 pb-1 font-medium text-xs">Agents in this channel</p>
        {roster === null ? (
          <span className="loading loading-spinner loading-xs mx-2" />
        ) : roster.length === 0 ? (
          <p className="px-2 text-base-content/50 text-xs">
            No agents registered.
          </p>
        ) : (
          roster.map((a) => (
            <label
              key={a.id}
              className="label cursor-pointer justify-start gap-2 px-2 py-1"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={assigned.includes(a.id)}
                onChange={() => void toggle(a.id)}
              />
              <span className="text-sm">{a.name ?? a.id}</span>
            </label>
          ))
        )}
      </div>
    </div>
  )
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
  const [newKind, setNewKind] = useState<"voice" | "text">("voice")
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
      await load()
    } finally {
      setCreating(false)
    }
  }

  if (channels === null) {
    return <span className="loading loading-spinner loading-sm" />
  }

  const regular = channels.filter((c) => !c.isDm)
  const dms = channels.filter((c) => c.isDm)

  return (
    <div className="w-full max-w-md">
      <SearchBox />
      <ul className="menu w-full rounded-box border border-base-300 bg-base-200/20 p-2">
        {regular.length === 0 && (
          <li className="menu-title">
            No channels yet{canCreate ? " — create one below" : ""}
          </li>
        )}
        {regular.map((c) => (
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
                  {c.unread && (
                    <span className="size-2 rounded-full bg-primary" />
                  )}
                </span>
                <span className="flex items-center gap-1">
                  {canCreate && <AgentAssign room={c.room} />}
                  {c.occupants > 0 && (
                    <span className="badge badge-soft badge-primary badge-sm">
                      {c.occupants}
                    </span>
                  )}
                </span>
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
      <div className="mt-3 flex items-center justify-between px-1">
        <span className="font-medium text-base-content/60 text-xs">
          Direct messages
        </span>
        <DmStart />
      </div>
      <ul className="menu w-full rounded-box border border-base-300 bg-base-200/20 p-2">
        {dms.length === 0 && (
          <li className="menu-title text-xs">No conversations yet</li>
        )}
        {dms.map((c) => (
          <li key={c.slug}>
            <button
              type="button"
              className="flex items-center justify-between"
              onClick={() => router.push(`/c/${c.slug}`)}
            >
              <span className="flex items-center gap-2">
                <MessageCircle className="size-4 text-base-content/60" />
                {c.dmPeers.join(", ") || "Direct message"}
                {c.unread && (
                  <span className="size-2 rounded-full bg-primary" />
                )}
              </span>
              {c.occupants > 0 && (
                <span className="badge badge-soft badge-primary badge-sm">
                  huddling
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {canCreate && (
        <form onSubmit={create} className="mt-3 flex items-center gap-2">
          <select
            className="select select-sm w-24"
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as "voice" | "text")}
          >
            <option value="voice">Voice</option>
            <option value="text">Text</option>
          </select>
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
