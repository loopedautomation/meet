"use client"

import { Bot, Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "react-toastify"
import { presenceDotClass } from "@/components/ui/Avatar"

type Member = {
  id: string
  name: string | null
  email: string | null
  online: boolean
  presence?: "active" | "away" | "dnd"
}

type FriendRequestStatus = {
  connectedUserIds: string[]
  outgoing: { id: string; otherUser: { id: string } }[]
}

/** Start (or reopen) a DM — pick a teammate, land in the conversation.
 * Members you're not already connected to (no existing DM, no accepted
 * request) get "Send request" instead of "Message" — see #284. */
export function DmStart() {
  const router = useRouter()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [connected, setConnected] = useState<Set<string>>(new Set())
  // userId -> that request's id, so a re-click can cancel it.
  const [outgoingByUser, setOutgoingByUser] = useState<Map<string, string>>(
    new Map(),
  )
  const [sendingTo, setSendingTo] = useState<string | null>(null)

  const open = async () => {
    try {
      const [membersRes, agentsRes, requestsRes] = await Promise.all([
        fetch("/api/members"),
        fetch("/api/agents/server"),
        fetch("/api/friend-requests"),
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
      if (requestsRes.ok) {
        const data = (await requestsRes.json()) as FriendRequestStatus
        setConnected(new Set(data.connectedUserIds))
        setOutgoingByUser(
          new Map(data.outgoing.map((r) => [r.otherUser.id, r.id])),
        )
      }
    } catch {
      setMembers([])
    }
  }

  const start = async (body: { userIds: string[] } | { agentId: string }) => {
    const res = await fetch("/api/dms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    if (!res?.ok || !data?.slug) {
      toast.error(data?.error ?? "Could not open the conversation.")
      return
    }
    router.push(`/c/${data.slug}`)
  }

  const sendRequest = async (userId: string) => {
    setSendingTo(userId)
    try {
      const res = await fetch("/api/friend-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipientId: userId }),
      }).catch(() => null)
      const data = await res?.json().catch(() => null)
      if (!res?.ok || !data?.id) {
        toast.error(data?.error ?? "Could not send the request.")
        return
      }
      setOutgoingByUser((prev) => new Map(prev).set(userId, data.id))
      toast.success("Request sent.")
    } finally {
      setSendingTo(null)
    }
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
      <div className="dropdown-content z-10 max-h-64 w-60 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow">
        {members === null ? (
          <span className="loading loading-spinner loading-xs mx-2" />
        ) : (
          <>
            {members.length <= 1 && agents.length === 0 && (
              <p className="px-2 text-base-content/50 text-xs">
                No teammates yet — invite someone.
              </p>
            )}
            {members.map((m) => {
              const isConnected = connected.has(m.id)
              const requested = outgoingByUser.has(m.id)
              return (
                <div
                  key={m.id}
                  className="flex w-full items-center gap-2 rounded-btn px-2 py-1 text-sm"
                >
                  <span
                    className={`size-2 shrink-0 rounded-full ${presenceDotClass(m)}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {m.name ?? m.email ?? "someone"}
                  </span>
                  {isConnected ? (
                    <button
                      type="button"
                      className="link link-hover shrink-0 text-xs"
                      onClick={() => void start({ userIds: [m.id] })}
                    >
                      Message
                    </button>
                  ) : requested ? (
                    <span className="shrink-0 text-base-content/40 text-xs">
                      Requested
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="link link-hover shrink-0 text-xs"
                      disabled={sendingTo === m.id}
                      onClick={() => void sendRequest(m.id)}
                    >
                      Send request
                    </button>
                  )}
                </div>
              )
            })}
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
