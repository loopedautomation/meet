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

/** Start (or reopen) a DM — pick a teammate, land in the conversation. */
export function DmStart() {
  const router = useRouter()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])

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
                  className={`size-2 rounded-full ${presenceDotClass(m)}`}
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
