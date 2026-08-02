"use client"

import { Bot } from "lucide-react"
import { useState } from "react"
import { toast } from "react-toastify"

type RosterAgent = { id: string; name?: string }

/** Admin control: which agents live in this channel. Assigned agents are
 * dispatched when the first human joins and parked when it empties. */
export function AgentAssign({ room }: { room: string }) {
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
