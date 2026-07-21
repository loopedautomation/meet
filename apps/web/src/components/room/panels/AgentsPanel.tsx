"use client"

import { useParticipants } from "@livekit/components-react"
import {
  AGENT_VOICES,
  type AgentActivityEvent,
  parseParticipantMeta,
} from "@meet/shared"
import { useStore } from "@nanostores/react"
import { Bot, ChevronDown, Plus, Wrench } from "lucide-react"
import { useState } from "react"
import { toast } from "react-toastify"
import { AgentControls } from "@/components/room/AgentControls"
import {
  type AgentMode,
  useAgentInvite,
} from "@/hooks/mutations/useAgentInvite"
import { useAgents } from "@/hooks/queries/useAgents"
import { useAgentPermissions } from "@/hooks/useRoomSettings"
import { useSendAgentControl } from "@/hooks/useSendAgentControl"
import { readHostKey } from "@/lib/hostKey"
import { $agentActivity, $agentStats } from "@/stores/roomData"

export function AgentsPanel({ slug }: { slug: string }) {
  const { data: agents = [], isLoading } = useAgents()
  const participants = useParticipants()
  const invite = useAgentInvite(slug)
  const activity = useStore($agentActivity)
  // Agents are the room's, not the organiser's — everyone gets the controls
  // unless the host has reserved them.
  const { canControl, canInvite } = useAgentPermissions()
  const sendControl = useSendAgentControl()
  // Per-agent interaction-mode choice ("" = the agent's registry default).
  // Meeting-level, not agent-level: any brain can front realtime or pipeline.
  const [modes, setModes] = useState<Record<string, AgentMode | "">>({})
  // Accordion: one card open at a time; collapsed rows are just icon + name.
  const [expanded, setExpanded] = useState<string | null>(null)

  const agentParticipants = new Map(
    participants
      .map((p) => [parseParticipantMeta(p.metadata)?.agentId, p] as const)
      .filter(([id]) => id),
  )

  // One mutation serves every row, so isPending alone would disable all the
  // Invite buttons at once — scope it to the agent actually being invited.
  const isInviting = (agentId: string) =>
    invite.isPending && invite.variables?.agentId === agentId

  // URL-invited agents aren't in the registry, but they're in the room —
  // give them a row too, or they'd have a tile but no panel presence.
  const registryIds = new Set(agents.map((a) => a.id))
  const dynamicAgents = [...agentParticipants.entries()]
    .filter(([id]) => id && !registryIds.has(id))
    .map(([id, p]) => ({
      id: id as string,
      name: p.name || (id as string),
      // The agent's own description, from its hello frame; fall back for
      // agents on an older framework that don't report one.
      description:
        parseParticipantMeta(p.metadata)?.description ?? "Invited by URL",
    }))
  const allAgents = [...agents, ...dynamicAgents]

  return (
    // Two scroll regions: the agent list (with invite + stats) takes the
    // flexible space; the activity feed keeps a bounded strip at the bottom.
    // Without this the h-full column inside the panel's own scroll container
    // pinned to viewport height and neither section scrolled properly.
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="space-y-2 p-4">
          {isLoading && (
            <li className="text-base-content/50 text-sm">Loading agents…</li>
          )}
          {!isLoading && allAgents.length === 0 && (
            <li className="text-base-content/50 text-sm">
              No agents registered. Add them to agent-registry.yaml.
            </li>
          )}
          {allAgents.map((agent) => {
            const participant = agentParticipants.get(agent.id)
            const open = expanded === agent.id
            return (
              <li
                key={agent.id}
                className="flex flex-col gap-2 rounded-field bg-base-200 p-3"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 text-left"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : agent.id)}
                >
                  <Bot className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{agent.name}</p>
                    {open && agent.description && (
                      <p className="text-base-content/60 text-xs">
                        {agent.description}
                      </p>
                    )}
                  </div>
                  {participant && (
                    <span className="badge badge-ghost badge-sm shrink-0">
                      in call
                    </span>
                  )}
                  <ChevronDown
                    className={`size-4 shrink-0 text-base-content/40 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
                {!open ? null : participant ? (
                  <AgentControls
                    withCaption
                    agentId={agent.id}
                    participant={participant}
                    disabled={!canControl}
                    onRemove={() =>
                      invite.mutate(
                        { agentId: agent.id, action: "remove" },
                        // Announced only once it actually happened — a
                        // removal the server refused must not be reported
                        // to the room as done.
                        {
                          onSuccess: () =>
                            sendControl(
                              { type: "remove", agentId: agent.id },
                              agent.name,
                            ),
                        },
                      )
                    }
                    sendControl={(control) => sendControl(control, agent.name)}
                  />
                ) : canInvite ? (
                  <div className="join w-full">
                    <select
                      className="select select-sm join-item min-w-0 flex-1 border border-base-300 text-xs"
                      value={modes[agent.id] ?? ""}
                      onChange={(e) =>
                        setModes((m) => ({
                          ...m,
                          [agent.id]: e.target.value as AgentMode | "",
                        }))
                      }
                      aria-label="Interaction mode"
                    >
                      <option value="">Default</option>
                      <option value="realtime">Realtime</option>
                      <option value="pipeline">STT + TTS</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm join-item"
                      disabled={isInviting(agent.id)}
                      onClick={() =>
                        invite.mutate({
                          agentId: agent.id,
                          action: "invite",
                          mode: modes[agent.id] || undefined,
                        })
                      }
                    >
                      {isInviting(agent.id) ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      Invite
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>

        {!canInvite && (
          <p className="px-4 pb-2 text-base-content/50 text-xs">
            The meeting's organiser has reserved inviting agents.
          </p>
        )}

        {canInvite && <InviteByUrl slug={slug} />}

        <StatsForNerds agents={agents} />
      </div>

      <div className="shrink-0 border-base-300 border-t px-4 py-2 font-medium text-base-content/60 text-xs uppercase tracking-wide">
        Activity
      </div>
      <ActivityFeed activity={activity} />
    </div>
  )
}

/** Per-agent pipeline configuration + live latency, LiveKit-benchmark style. */
function StatsForNerds({ agents }: { agents: { id: string; name: string }[] }) {
  const stats = useStore($agentStats)
  const entries = agents.filter((a) => stats[a.id])
  if (entries.length === 0) return null

  return (
    <details className="border-base-300 border-t">
      <summary className="cursor-pointer px-4 py-2 font-medium text-base-content/60 text-xs uppercase tracking-wide">
        Stats for nerds
      </summary>
      <div className="space-y-3 px-4 pb-3">
        {entries.map((agent) => {
          const s = stats[agent.id]
          return (
            <div key={agent.id} className="rounded-field bg-base-200 p-3">
              <p className="mb-1 font-medium text-sm">{agent.name}</p>
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(s.config).map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-0.5 pr-2 text-base-content/60">{k}</td>
                      <td className="break-all font-mono">{v}</td>
                    </tr>
                  ))}
                  {Object.entries(s.latencyMs).map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-0.5 pr-2 text-base-content/60">
                        {k} latency
                      </td>
                      <td
                        className={`font-mono ${k === "overall" ? "font-semibold" : ""}`}
                      >
                        {v}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </details>
  )
}

/**
 * Successful URL invites, remembered per browser so kicking an agent doesn't
 * mean retyping its URL and token next time. Token included deliberately —
 * it's the inviter's own credential on their own device (same trust level as
 * the stored rejoin token).
 */
type RecentAgent = {
  url: string
  token: string
  name: string
  voice?: string
  at: number
}
const RECENT_AGENTS_KEY = "recentAgents"
const MAX_RECENT_AGENTS = 5

function readRecentAgents(): RecentAgent[] {
  if (typeof window === "undefined") return []
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_AGENTS_KEY) ?? "[]")
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function rememberAgent(entry: RecentAgent): RecentAgent[] {
  const list = [
    entry,
    ...readRecentAgents().filter((a) => a.url !== entry.url),
  ].slice(0, MAX_RECENT_AGENTS)
  try {
    localStorage.setItem(RECENT_AGENTS_KEY, JSON.stringify(list))
  } catch {}
  return list
}

function forgetAgent(url: string): RecentAgent[] {
  const list = readRecentAgents().filter((a) => a.url !== url)
  try {
    localStorage.setItem(RECENT_AGENTS_KEY, JSON.stringify(list))
  } catch {}
  return list
}

/** Bring any looped agent into the call by its TTY URL — no registration. */
function InviteByUrl({ slug }: { slug: string }) {
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [voice, setVoice] = useState<string>(AGENT_VOICES[0])
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<RecentAgent[]>(readRecentAgents)

  const inviteAgent = async (spec: {
    url: string
    token: string
    voice?: string
  }) => {
    setBusy(true)
    try {
      const hostKey = readHostKey(slug)
      const res = await fetch(`/api/rooms/${slug}/agents`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(hostKey ? { "x-host-key": hostKey } : {}),
        },
        body: JSON.stringify(spec),
      })
      const data = (await res.json()) as { error?: string; name?: string }
      if (!res.ok) throw new Error(data.error ?? "invite failed")
      setRecent(
        rememberAgent({
          url: spec.url,
          token: spec.token,
          name: data.name || spec.url,
          voice: spec.voice,
          at: Date.now(),
        }),
      )
      return true
    } catch (err) {
      toast.error((err as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    if (await inviteAgent({ url: url.trim(), token: token.trim(), voice })) {
      setUrl("")
      setToken("")
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-base-300 border-t p-4">
      <p className="font-medium text-base-content/60 text-xs uppercase tracking-wide">
        Invite by URL
      </p>
      {recent.length > 0 && (
        <ul className="space-y-1">
          {recent.map((a) => (
            <li key={a.url} className="flex items-center gap-1">
              <button
                type="button"
                className="btn btn-ghost btn-xs min-w-0 flex-1 justify-start gap-1 font-normal"
                disabled={busy}
                title={a.url}
                onClick={() =>
                  inviteAgent({ url: a.url, token: a.token, voice: a.voice })
                }
              >
                <Plus className="size-3 shrink-0" />
                <span className="truncate">{a.name}</span>
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-circle text-base-content/40"
                aria-label={`Forget ${a.name}`}
                onClick={() => setRecent(forgetAgent(a.url))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        className="input input-sm w-full"
        placeholder="your-agent.lpd.sh"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <input
        className="input input-sm w-full"
        placeholder="Access token"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <select
        className="select select-sm w-full border border-base-300"
        value={voice}
        onChange={(e) => setVoice(e.target.value)}
        aria-label="Agent voice"
      >
        {AGENT_VOICES.map((v) => (
          <option key={v} value={v}>
            Voice: {v}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="btn btn-primary btn-sm w-full"
        disabled={busy || !url.trim()}
      >
        {busy && <span className="loading loading-spinner loading-xs" />}
        Invite agent
      </button>
    </form>
  )
}

function ActivityFeed({ activity }: { activity: AgentActivityEvent[] }) {
  if (activity.length === 0) {
    return (
      <p className="px-4 py-2 text-base-content/50 text-sm">
        Tool calls will appear here while an agent works.
      </p>
    )
  }
  return (
    <ul className="max-h-56 shrink-0 space-y-1 overflow-y-auto px-4 pb-4">
      {activity
        .filter((e) => e.type === "tool_call" || e.type === "tool_result")
        // Newest at the top — the live call is what you came to watch.
        .reverse()
        .map((e) => (
          <li
            key={`${e.type}-${e.at}`}
            className="rounded-field bg-base-200 p-2 font-mono text-xs"
          >
            <span className="flex items-center gap-1 text-primary">
              <Wrench className="size-3" />
              {e.type === "tool_call" ? `→ ${e.name}` : `← ${e.name}`}
              {e.type === "tool_result" && (
                <span className="text-base-content/50">{e.durationMs}ms</span>
              )}
            </span>
            <span className="line-clamp-3 break-all text-base-content/70">
              {e.type === "tool_call" ? e.arguments : e.content}
            </span>
          </li>
        ))}
    </ul>
  )
}
