"use client"

import { useStore } from "@nanostores/react"
import {
  Bot,
  ChevronDown,
  Hash,
  MessageCircle,
  PhoneCall,
  Plus,
  Shield,
  UserPlus,
  Volume2,
  X,
} from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "react-toastify"
import { Avatar } from "@/components/ui/Avatar"
import { $activeCall } from "@/stores/activeCall"
import { $mobileSidebarOpen } from "@/stores/mobileSidebar"
import { AgentAssign } from "./AgentAssign"
import { CreateChannelModal } from "./CreateChannelModal"
import { CreateServerModal } from "./CreateServerModal"
import { DmStart } from "./DmStart"
import { type Presence, ProfileCard } from "./ProfileCard"
import { SearchBox } from "./SearchBox"

type Occupant = {
  identity: string
  name: string | null
  kind: string | null
}

/** Mirrors the server's DmPeer shape (apps/web/src/lib/server/channels.ts) —
 * enough to render an avatar with a presence dot for a DM's other side. */
type DmPeer = {
  id: string
  name: string
  image: string | null
  isAgent: boolean
  online: boolean
  presence: string | null
}

export type ChannelRow = {
  slug: string
  name: string
  kind: "voice" | "text"
  topic: string | null
  isPrivate: boolean
  isDm: boolean
  dmPeers: DmPeer[]
  unread: boolean
  room: string
  occupants: number
  occupantList: Occupant[]
}

export type SidebarUser = {
  name: string | null
  email: string | null
  image: string | null
  presence: Presence
  role: "owner" | "admin" | "member"
}

export type ServerSummary = {
  id: string
  slug: string
  name: string
  iconUrl: string | null
  role: "owner" | "admin" | "member"
}

/**
 * The persistent app shell sidebar — Discord-style. Lives in the (app)
 * layout so it survives navigation: the presence SSE connection (which
 * also registers this member as online) stays open while moving between
 * channels, DMs, settings and admin. Slow polling covers SSE gaps.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is the app shell's root component — the branching is panel/mobile-drawer/resize state that's clearer inline than split across files
export function AppSidebar({
  user,
  serverName,
  servers,
  activeServerId,
}: {
  user: SidebarUser
  serverName: string
  /** Every server this member belongs to — the switcher rail's data. */
  servers: ServerSummary[]
  activeServerId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const activeCall = useStore($activeCall)
  const mobileOpen = useStore($mobileSidebarOpen)
  const canCreate = user.role !== "member"
  const [channels, setChannels] = useState<ChannelRow[] | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showCreateServer, setShowCreateServer] = useState(false)
  const [switching, setSwitching] = useState(false)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const switchServer = async (serverId: string) => {
    if (serverId === activeServerId || switching) return
    setSwitching(true)
    try {
      const res = await fetch("/api/servers/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serverId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Could not switch servers.")
        return
      }
      router.push("/home")
      router.refresh()
    } finally {
      setSwitching(false)
    }
  }

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

  // The drawer covers the page it navigated to below md — close it once
  // the route it was opened for has changed. pathname itself is unused
  // in the body; it's here purely to retrigger the effect on navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is an intentional retrigger, not a value the effect reads
  useEffect(() => {
    $mobileSidebarOpen.set(false)
  }, [pathname])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") $mobileSidebarOpen.set(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mobileOpen])

  const mintInvite = async () => {
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    if (!res?.ok || !data?.url) {
      toast.error(data?.error ?? "Could not mint the invite.")
      return
    }
    await navigator.clipboard.writeText(data.url).catch(() => {})
    toast.success("Invite link copied to your clipboard.")
  }

  const regular = channels?.filter((c) => !c.isDm) ?? []
  const dms = channels?.filter((c) => c.isDm) ?? []

  const itemClass = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-sm ${
      active
        ? "bg-base-300/70 font-medium"
        : "text-base-content/80 hover:bg-base-200"
    }`

  // Which panel the inner sidebar shows: the server's channels or your
  // direct messages (Discord's rail). Visiting a DM URL flips to DMs; the
  // rail buttons override explicitly.
  const activeDmRoute = dms.some((c) => pathname === `/c/${c.slug}`)
  const [railChoice, setRailChoice] = useState<"server" | "dms" | null>(null)
  const panel = railChoice ?? (activeDmRoute ? "dms" : "server")
  const dmUnread = dms.some((c) => c.unread)
  const serverUnread = regular.some((c) => c.unread)

  // Resizable inner panel — clamped, remembered across sessions.
  const MIN_PANEL = 200
  const MAX_PANEL = 420
  const [panelWidth, setPanelWidth] = useState(240)
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem("sidebarWidth"))
      if (w >= MIN_PANEL && w <= MAX_PANEL) setPanelWidth(w)
    } catch {}
  }, [])
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidth
    const clamp = (w: number) => Math.min(MAX_PANEL, Math.max(MIN_PANEL, w))
    const move = (ev: PointerEvent) =>
      setPanelWidth(clamp(startW + ev.clientX - startX))
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      try {
        localStorage.setItem(
          "sidebarWidth",
          String(clamp(startW + ev.clientX - startX)),
        )
      } catch {}
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const railButton = (active: boolean) =>
    `relative flex size-11 items-center justify-center rounded-2xl transition-all ${
      active
        ? "bg-primary text-primary-content"
        : "bg-base-300/60 text-base-content/70 hover:rounded-xl hover:bg-primary/20"
    }`

  return (
    <>
      {/* Backdrop — mobile only, dims the page behind the slid-in drawer. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => $mobileSidebarOpen.set(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-full shrink-0 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          className="btn btn-circle btn-ghost btn-sm absolute top-2 right-2 z-10 bg-base-100/80 backdrop-blur md:hidden"
          aria-label="Close sidebar"
          title="Close sidebar"
          onClick={() => $mobileSidebarOpen.set(false)}
        >
          <X className="size-4" />
        </button>
        {/* Fixed rail: DMs, then this server (Discord-style). Opaque below
            md — translucent-on-base-100 only reads right when the sidebar
            sits statically beside the page, not stacked as a mobile
            overlay on top of it, where translucency just lets the page
            underneath show through. */}
        <div className="flex h-full w-16 shrink-0 flex-col items-center gap-2 border-base-300 border-r bg-base-300 py-3 md:bg-base-300/30">
          <button
            type="button"
            className={railButton(panel === "dms")}
            title="Direct messages"
            onClick={() => setRailChoice("dms")}
          >
            <MessageCircle className="size-5" />
            {dmUnread && panel !== "dms" && (
              <span className="absolute top-0 right-0 size-2.5 rounded-full bg-primary ring-2 ring-base-100" />
            )}
          </button>
          <div className="h-px w-8 bg-base-300" />
          {/* Server switcher — one button per server this member belongs
              to (Discord-style rail). Clicking a non-active one switches
              the active server and reloads the shell around it. */}
          {servers.map((s) => {
            const isActiveServer = s.id === activeServerId
            return (
              <ServerRailButton
                key={s.id}
                server={s}
                active={isActiveServer && panel === "server"}
                showUnread={
                  isActiveServer && serverUnread && panel !== "server"
                }
                disabled={switching}
                railButtonClass={railButton}
                onSelect={() => {
                  setRailChoice("server")
                  if (!isActiveServer) void switchServer(s.id)
                }}
              />
            )
          })}
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-2xl bg-base-300/60 text-success transition-all hover:rounded-xl hover:bg-success/20"
            title="Add a server"
            onClick={() => setShowCreateServer(true)}
          >
            <Plus className="size-5" />
          </button>
        </div>

        {/* Swappable panel + shared footer. Capped to a fraction of the
            viewport (not just MAX_PANEL) so a width resized wide on a
            desktop screen — panelWidth is shared/persisted across every
            screen size — can't blow the mobile drawer past the viewport
            it's sliding into; harmless on desktop, where 88vw always
            exceeds MAX_PANEL anyway. */}
        <div
          className="relative flex h-full flex-col border-base-300 border-r bg-base-200 md:bg-base-200/40"
          style={{ width: `min(${panelWidth}px, calc(88vw - 4rem))` }}
        >
          {panel === "server" ? (
            <>
              {/* Server header — the server-level menu (admin, invites) */}
              <div className="border-base-300 border-b">
                <div className="dropdown w-full">
                  <button
                    type="button"
                    tabIndex={0}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-base-200"
                  >
                    <span className="truncate font-semibold">{serverName}</span>
                    <ChevronDown className="size-4 shrink-0 text-base-content/50" />
                  </button>
                  <div className="dropdown-content z-20 mx-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-sm hover:bg-base-200"
                      onClick={() => router.push("/home")}
                    >
                      Server home
                    </button>
                    {canCreate && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-sm hover:bg-base-200"
                        onClick={() => void mintInvite()}
                      >
                        <UserPlus className="size-4" />
                        Invite people
                      </button>
                    )}
                    {canCreate && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-sm hover:bg-base-200"
                        onClick={() => router.push("/admin")}
                      >
                        <Shield className="size-4" />
                        Server admin
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-3 pt-3">
                <SearchBox />
              </div>

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
                            // Voice channels open chat-first, same as text
                            // channels — joining the call is an explicit
                            // action from that page (see #241).
                            onClick={() => router.push(`/c/${c.slug}`)}
                          >
                            {c.kind === "voice" ? (
                              activeCall?.room === c.room ? (
                                <span title="You're connected to this call">
                                  <PhoneCall className="size-4 shrink-0 text-success" />
                                </span>
                              ) : (
                                <Volume2 className="size-4 shrink-0 text-base-content/50" />
                              )
                            ) : (
                              <Hash className="size-4 shrink-0 text-base-content/50" />
                            )}
                            <span className="min-w-0 flex-1 truncate">
                              {c.slug}
                            </span>
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
                                  {o.kind === "agent" && (
                                    <Bot className="size-3" />
                                  )}
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
              </nav>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between border-base-300 border-b px-4 py-3">
                <span className="font-semibold">Direct messages</span>
                <DmStart />
              </div>
              <div className="px-3 pt-3">
                <SearchBox />
              </div>
              <nav className="flex-1 overflow-y-auto px-3 py-2">
                <ul className="flex flex-col gap-0.5">
                  {channels !== null && dms.length === 0 && (
                    <li className="px-2 py-1 text-base-content/50 text-xs">
                      No conversations yet — start one with +
                    </li>
                  )}
                  {dms.map((c) => {
                    const active = pathname === `/c/${c.slug}`
                    const peers = c.dmPeers
                    return (
                      <li key={c.slug}>
                        <button
                          type="button"
                          className={itemClass(active)}
                          onClick={() => router.push(`/c/${c.slug}`)}
                        >
                          {peers.length > 1 ? (
                            // Group DM: an overlapping cluster, Discord-style
                            // — individual presence doesn't fit at this size.
                            <span className="-space-x-2 flex shrink-0">
                              {peers.slice(0, 3).map((p) => (
                                <span
                                  key={p.id}
                                  className="rounded-full ring-2 ring-base-200"
                                >
                                  <Avatar
                                    name={p.name}
                                    image={p.image}
                                    isAgent={p.isAgent}
                                    size="xs"
                                  />
                                </span>
                              ))}
                            </span>
                          ) : peers.length === 1 ? (
                            <Avatar
                              name={peers[0].name}
                              image={peers[0].image}
                              isAgent={peers[0].isAgent}
                              online={peers[0].online}
                              presence={peers[0].presence}
                              size="sm"
                            />
                          ) : (
                            <MessageCircle className="size-4 shrink-0 text-base-content/50" />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {peers.map((p) => p.name).join(", ") ||
                              "Direct message"}
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
            </>
          )}

          {/* User footer — profile card with presence + call defaults */}
          <div className="border-base-300 border-t bg-base-200/60 px-2 py-2">
            <ProfileCard
              user={{
                name: user.name,
                email: user.email,
                image: user.image,
                presence: user.presence,
              }}
            />
          </div>

          {/* Drag handle — resize the panel within [MIN_PANEL, MAX_PANEL] */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only resize affordance; keyboard users can't need it — width is cosmetic */}
          <div
            className="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize hover:bg-primary/30 active:bg-primary/40 md:block"
            onPointerDown={startResize}
          />
        </div>
      </aside>
      <CreateChannelModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(slug) => {
          void load()
          router.push(`/c/${slug}`)
        }}
      />
      <CreateServerModal
        isOpen={showCreateServer}
        onClose={() => setShowCreateServer(false)}
        onCreated={(defaultChannelSlug) => {
          router.push(`/c/${defaultChannelSlug}`)
          router.refresh()
        }}
      />
    </>
  )
}

function ServerRailButton({
  server,
  active,
  showUnread,
  disabled,
  railButtonClass,
  onSelect,
}: {
  server: ServerSummary
  active: boolean
  showUnread: boolean
  disabled: boolean
  railButtonClass: (active: boolean) => string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={railButtonClass(active)}
      title={server.name}
      disabled={disabled}
      onClick={onSelect}
    >
      {server.iconUrl ? (
        <img
          src={server.iconUrl}
          alt=""
          className="size-full rounded-2xl object-cover"
        />
      ) : (
        <span className="font-semibold text-sm">
          {server.name.slice(0, 2).toUpperCase()}
        </span>
      )}
      {showUnread && (
        <span className="absolute top-0 right-0 size-2.5 rounded-full bg-primary ring-2 ring-base-100" />
      )}
    </button>
  )
}
