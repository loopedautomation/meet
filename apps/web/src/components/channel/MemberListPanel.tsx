"use client"

import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { Avatar } from "@/components/ui/Avatar"

type Member = {
  id: string
  name: string
  image: string | null
  online: boolean
  presence: string | null
  role: string | null
}

/**
 * Discord-style member list side panel for the current text channel —
 * `/api/channels/[room]/members` already scopes the roster (full server
 * for public channels, `channel_members` subset for private channels/DMs),
 * so this component just renders what it's given, split into Online /
 * Offline groups. Shares the search panel's `<aside>` shell so the two
 * slide into the same slot in `TextChannelView` without fighting for
 * layout space.
 */
export function MemberListPanel({
  room,
  onClose,
}: {
  room: string
  onClose: () => void
}) {
  const [members, setMembers] = useState<Member[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setMembers(null)
    void fetch(`/api/channels/${room}/members`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { members: Member[] } | null) => {
        if (!cancelled) setMembers(d?.members ?? [])
      })
      .catch(() => {
        if (!cancelled) setMembers([])
      })
    return () => {
      cancelled = true
    }
  }, [room])

  const online = (members ?? []).filter((m) => m.online)
  const offline = (members ?? []).filter((m) => !m.online)

  return (
    <aside className="absolute inset-0 z-20 flex flex-col bg-base-100 md:static md:z-auto md:w-64 md:shrink-0 md:border-base-300 md:border-l">
      <div className="flex items-center justify-between gap-2 border-base-300 border-b px-3 py-3">
        <span className="font-medium text-sm">Members</span>
        <button
          type="button"
          className="btn btn-ghost btn-circle btn-sm shrink-0"
          onClick={onClose}
          aria-label="Close member list"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {members === null ? (
          <div className="flex justify-center py-8">
            <span className="loading loading-spinner loading-sm" />
          </div>
        ) : members.length === 0 ? (
          <p className="px-2 py-4 text-center text-base-content/50 text-xs">
            No members to show.
          </p>
        ) : (
          <>
            {online.length > 0 && (
              <MemberGroup label="Online" members={online} />
            )}
            {offline.length > 0 && (
              <MemberGroup label="Offline" members={offline} />
            )}
          </>
        )}
      </div>
    </aside>
  )
}

function MemberGroup({ label, members }: { label: string; members: Member[] }) {
  return (
    <div className="mb-3">
      <p className="px-2 py-1 font-medium text-base-content/40 text-xs uppercase tracking-wide">
        {label} — {members.length}
      </p>
      {members.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-2 rounded-btn px-2 py-1.5"
        >
          <Avatar
            name={m.name}
            image={m.image}
            size="sm"
            online={m.online}
            presence={m.presence}
          />
          <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
          {m.role && m.role !== "member" && (
            <span className="badge badge-ghost badge-xs shrink-0 capitalize">
              {m.role}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
