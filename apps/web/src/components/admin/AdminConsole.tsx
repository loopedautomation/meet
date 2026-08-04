"use client"

import { Copy, Download, ShieldCheck, Trash2, UserMinus } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "react-toastify"

type Member = {
  id: string
  name: string | null
  email: string | null
  role: "owner" | "admin" | "member"
  online: boolean
}

type Invite = {
  code: string
  role: string
  useCount: number
  maxUses: number | null
  expiresAt: string | null
  revokedAt: string | null
}

type Settings = {
  name: string | null
  registration: "invite" | "open"
  retentionDays: number | null
}

export function AdminConsole({
  isOwner,
  selfId,
}: {
  isOwner: boolean
  selfId: string
}) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [roster, setRoster] = useState<{ id: string; name?: string }[]>([])
  const [serverAgents, setServerAgents] = useState<string[]>([])

  const load = useCallback(async () => {
    const [s, m, i, r, sa] = await Promise.all([
      fetch("/api/admin/settings").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/members").then((r) => (r.ok ? r.json() : { members: [] })),
      fetch("/api/invites").then((r) => (r.ok ? r.json() : { invites: [] })),
      fetch("/api/agents").then((r) => (r.ok ? r.json() : { agents: [] })),
      fetch("/api/agents/server").then((r) =>
        r.ok ? r.json() : { agents: [] },
      ),
    ])
    if (s) setSettings(s)
    setMembers(m.members ?? [])
    setInvites(i.invites ?? [])
    setRoster(r.agents ?? [])
    setServerAgents((sa.agents ?? []).map((a: { id: string }) => a.id))
  }, [])

  const toggleAgent = async (agentId: string) => {
    const invited = serverAgents.includes(agentId)
    const res = await fetch("/api/agents/server", {
      method: invited ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId }),
    })
    if (!res.ok) toast.error("Could not update the server's agents.")
    await load()
  }

  useEffect(() => {
    void load()
  }, [load])

  const patchSettings = async (patch: Partial<Settings>) => {
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      toast.error("Could not save settings.")
      return
    }
    setSettings(await res.json())
  }

  const mintInvite = async (role: "member" | "admin") => {
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.url) {
      toast.error(data?.error ?? "Could not mint the invite.")
      return
    }
    await navigator.clipboard.writeText(data.url).catch(() => {})
    toast.success("Invite link copied to your clipboard.")
    await load()
  }

  const setRole = async (m: Member, role: "admin" | "member") => {
    const res = await fetch(`/api/admin/members/${m.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    })
    if (!res.ok) toast.error("Could not change the role.")
    await load()
  }

  const removeMember = async (m: Member, purge: boolean) => {
    const label = purge
      ? `Erase ${m.name ?? m.email}'s account and personal data? This is the GDPR delete — it cannot be undone.`
      : `Remove ${m.name ?? m.email} from this server? They'd need a fresh invite to come back.`
    if (!window.confirm(label)) return
    const res = await fetch(
      `/api/admin/members/${m.id}${purge ? "?purge=1" : ""}`,
      {
        method: "DELETE",
      },
    )
    const data = await res.json().catch(() => null)
    if (!res.ok) toast.error(data?.error ?? "Could not remove the member.")
    await load()
  }

  const revokeInvite = async (code: string) => {
    await fetch(`/api/invites/${code}`, { method: "DELETE" }).catch(() => {})
    await load()
  }

  return (
    <main className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto px-6 pb-16">
      <header className="py-6">
        <h1 className="font-semibold text-xl">Server admin</h1>
      </header>

      <section className="card card-border bg-base-200/20">
        <div className="card-body gap-4">
          <h2 className="card-title text-base">Instance</h2>
          {settings === null ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            <>
              <label className="form-control w-full max-w-sm">
                <span className="label-text pb-1 text-xs">Server name</span>
                <input
                  className="input input-sm"
                  defaultValue={settings.name ?? ""}
                  placeholder="Acme Inc"
                  disabled={!isOwner}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v !== (settings.name ?? ""))
                      void patchSettings({ name: v || null })
                  }}
                />
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="toggle toggle-sm"
                  checked={settings.registration === "open"}
                  disabled={!isOwner}
                  onChange={(e) =>
                    void patchSettings({
                      registration: e.target.checked ? "open" : "invite",
                    })
                  }
                />
                <span className="text-sm">
                  Public server — anyone who signs in may join (off =
                  invite-only)
                </span>
              </label>
              <label className="form-control w-full max-w-sm">
                <span className="label-text pb-1 text-xs">
                  Message retention (days; empty keeps everything)
                </span>
                <input
                  className="input input-sm w-32"
                  type="number"
                  min={1}
                  defaultValue={settings.retentionDays ?? ""}
                  disabled={!isOwner}
                  onBlur={(e) => {
                    const v = e.target.value ? Number(e.target.value) : null
                    if (v !== settings.retentionDays)
                      void patchSettings({ retentionDays: v })
                  }}
                />
              </label>
              {isOwner && (
                <a
                  href="/api/admin/export"
                  className="btn btn-outline btn-sm w-fit"
                >
                  <Download className="size-4" />
                  Export everything (JSON)
                </a>
              )}
            </>
          )}
        </div>
      </section>

      <section className="card card-border bg-base-200/20">
        <div className="card-body gap-3">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-base">Members</h2>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void mintInvite("member")}
              >
                <Copy className="size-4" />
                Invite link
              </button>
              {isOwner && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => void mintInvite("admin")}
                >
                  <ShieldCheck className="size-4" />
                  Admin invite
                </button>
              )}
            </div>
          </div>
          <ul className="divide-y divide-base-300">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2">
                <span className="flex items-center gap-2 text-sm">
                  <span
                    className={`size-2 rounded-full ${m.online ? "bg-success" : "bg-base-content/20"}`}
                  />
                  {m.name ?? m.email ?? m.id.slice(0, 8)}
                  <span className="badge badge-ghost badge-sm">{m.role}</span>
                </span>
                {m.role !== "owner" && m.id !== selfId && (
                  <span className="flex items-center gap-1">
                    {isOwner && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() =>
                          void setRole(
                            m,
                            m.role === "admin" ? "member" : "admin",
                          )
                        }
                      >
                        {m.role === "admin" ? "Demote" : "Make admin"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      title="Remove from server"
                      onClick={() => void removeMember(m, false)}
                    >
                      <UserMinus className="size-3.5" />
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-error"
                        title="Erase account + data (GDPR delete)"
                        onClick={() => void removeMember(m, true)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card card-border bg-base-200/20">
        <div className="card-body gap-2">
          <h2 className="card-title text-base">Agents</h2>
          <p className="text-base-content/60 text-xs">
            Invited agents are DMable and can join group chats and channels.
            Every registry agent is already offered inside meetings.
          </p>
          {roster.length === 0 ? (
            <p className="text-base-content/50 text-sm">
              No agents registered on the bridge.
            </p>
          ) : (
            <ul className="divide-y divide-base-300">
              {roster.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>{a.name ?? a.id}</span>
                  <input
                    type="checkbox"
                    className="toggle toggle-sm"
                    checked={serverAgents.includes(a.id)}
                    onChange={() => void toggleAgent(a.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card card-border bg-base-200/20">
        <div className="card-body gap-2">
          <h2 className="card-title text-base">Invites</h2>
          {invites.filter((i) => !i.revokedAt).length === 0 ? (
            <p className="text-base-content/50 text-sm">No active invites.</p>
          ) : (
            <ul className="divide-y divide-base-300">
              {invites
                .filter((i) => !i.revokedAt)
                .map((i) => (
                  <li
                    key={i.code}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="font-mono">{i.code}</span>
                    <span className="flex items-center gap-2 text-base-content/60 text-xs">
                      {i.role} · used {i.useCount}
                      {i.maxUses ? `/${i.maxUses}` : ""}
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => void revokeInvite(i.code)}
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
    </main>
  )
}
