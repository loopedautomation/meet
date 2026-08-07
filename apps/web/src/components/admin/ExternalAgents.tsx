"use client"

import { Copy, KeyRound, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "react-toastify"
import { copyToClipboard } from "@/lib/clipboard"

type ExternalAgent = {
  id: string
  name: string
  description: string | null
  urlHost: string
  registered: boolean
  lastSeenAt: number | null
}

type RegistrationToken = {
  id: string
  label: string | null
  createdAt: number
  lastUsedAt: number | null
  revoked: boolean
  agent: { id: string; name: string | null } | null
}

function ago(at: number | null): string {
  if (!at) return "never"
  const mins = Math.floor((Date.now() - at) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Admin console sections for durable external agents: the agents
 * themselves (paste a TTY URL + token) and the registration tokens agents
 * use to register themselves. Tokens are shown exactly once at mint time. */
export function ExternalAgents() {
  const [agents, setAgents] = useState<ExternalAgent[]>([])
  const [tokens, setTokens] = useState<RegistrationToken[]>([])
  // The freshly minted token — the only moment its plaintext exists client-side.
  const [minted, setMinted] = useState<string | null>(null)
  const [label, setLabel] = useState("")
  const [adding, setAdding] = useState(false)
  const [addUrl, setAddUrl] = useState("")
  const [addToken, setAddToken] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [a, t] = await Promise.all([
      fetch("/api/agents/external").then((r) =>
        r.ok ? r.json() : { agents: [] },
      ),
      fetch("/api/admin/agent-tokens").then((r) =>
        r.ok ? r.json() : { tokens: [] },
      ),
    ])
    setAgents(a.agents ?? [])
    setTokens(t.tokens ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const addAgent = async () => {
    if (!addUrl.trim()) return
    setBusy(true)
    try {
      const res = await fetch("/api/agents/external", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: addUrl.trim(), token: addToken }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        // The probe's error strings are written for people — show them as-is.
        toast.error(data?.error ?? "Could not add the agent.")
        return
      }
      toast.success(`${data.name} added.`)
      setAdding(false)
      setAddUrl("")
      setAddToken("")
      await load()
    } finally {
      setBusy(false)
    }
  }

  const removeAgent = async (agent: ExternalAgent) => {
    if (
      !window.confirm(
        `Remove ${agent.name}? Its channel assignments will stop resolving.`,
      )
    )
      return
    const res = await fetch("/api/agents/external", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: agent.id }),
    })
    if (!res.ok) toast.error("Could not remove the agent.")
    await load()
  }

  const mintToken = async () => {
    const res = await fetch("/api/admin/agent-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(label.trim() ? { label: label.trim() } : {}),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.token) {
      toast.error(data?.error ?? "Could not create the token.")
      return
    }
    setMinted(data.token)
    setLabel("")
    await load()
  }

  const revokeToken = async (t: RegistrationToken) => {
    if (
      !window.confirm(
        "Revoke this token? Agents holding it can no longer register or post.",
      )
    )
      return
    const res = await fetch("/api/admin/agent-tokens", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: t.id }),
    })
    if (!res.ok) toast.error("Could not revoke the token.")
    await load()
  }

  const activeTokens = tokens.filter((t) => !t.revoked)

  return (
    <>
      <section className="card card-border bg-base-200/20">
        <div className="card-body gap-3">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-base">External agents</h2>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setAdding((v) => !v)}
            >
              <Plus className="size-4" />
              Add agent
            </button>
          </div>
          <p className="text-base-content/60 text-xs">
            Durable looped-af agents connected by TTY URL. They join the server
            roster like registry agents — DMable, assignable to channels,
            offered in meetings.
          </p>
          {adding && (
            <div className="flex flex-col gap-2 rounded-box bg-base-200/40 p-3">
              <label className="form-control w-full">
                <span className="label-text pb-1 text-xs">
                  Agent URL (wss://… or a bare domain)
                </span>
                <input
                  className="input input-sm w-full font-mono"
                  value={addUrl}
                  placeholder="my-agent.example.com"
                  onChange={(e) => setAddUrl(e.target.value)}
                />
              </label>
              <label className="form-control w-full">
                <span className="label-text pb-1 text-xs">
                  Agent token (stored encrypted, never shown again)
                </span>
                <input
                  className="input input-sm w-full font-mono"
                  type="password"
                  value={addToken}
                  onChange={(e) => setAddToken(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy || !addUrl.trim()}
                  onClick={() => void addAgent()}
                >
                  {busy && (
                    <span className="loading loading-spinner loading-xs" />
                  )}
                  Probe & add
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {agents.length === 0 ? (
            <p className="text-base-content/50 text-sm">
              No external agents yet.
            </p>
          ) : (
            <ul className="divide-y divide-base-300">
              {agents.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2">
                      {a.name}
                      {a.registered && (
                        <span
                          className="badge badge-ghost badge-sm"
                          title="Self-registered with a registration token"
                        >
                          registered
                        </span>
                      )}
                    </span>
                    <span className="truncate font-mono text-base-content/50 text-xs">
                      {a.urlHost}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-base-content/60 text-xs">
                    seen {ago(a.lastSeenAt)}
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-error"
                      title="Remove agent"
                      onClick={() => void removeAgent(a)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card card-border bg-base-200/20">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">Agent registration tokens</h2>
          <p className="text-base-content/60 text-xs">
            An agent holding a token can register itself (and re-register after
            redeploys) against this server's /api/agents/register endpoint.
          </p>
          <div className="flex items-end gap-2">
            <label className="form-control w-full max-w-xs">
              <span className="label-text pb-1 text-xs">
                Label (optional — e.g. "scout on fly.io")
              </span>
              <input
                className="input input-sm w-full"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void mintToken()}
            >
              <KeyRound className="size-4" />
              Create token
            </button>
          </div>
          {minted && (
            <div className="flex flex-col gap-1 rounded-box border border-warning/40 bg-warning/10 p-3">
              <span className="text-xs">
                Copy this token now — you won't see it again.
              </span>
              <span className="flex items-center gap-2">
                <code className="break-all font-mono text-sm">{minted}</code>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs shrink-0"
                  title="Copy token"
                  onClick={async () => {
                    const ok = await copyToClipboard(minted)
                    if (ok) toast.success("Token copied.")
                    else toast.error("Could not copy the token.")
                  }}
                >
                  <Copy className="size-3.5" />
                </button>
              </span>
            </div>
          )}
          {activeTokens.length === 0 ? (
            <p className="text-base-content/50 text-sm">No active tokens.</p>
          ) : (
            <ul className="divide-y divide-base-300">
              {activeTokens.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span>{t.label ?? "Unlabeled token"}</span>
                    <span className="text-base-content/50 text-xs">
                      {t.agent
                        ? `agent: ${t.agent.name ?? t.agent.id}`
                        : "no agent registered yet"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-base-content/60 text-xs">
                    created {ago(t.createdAt)} · used {ago(t.lastUsedAt)}
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => void revokeToken(t)}
                    >
                      Revoke
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  )
}
