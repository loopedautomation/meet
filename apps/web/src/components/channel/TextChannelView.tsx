"use client"

import {
  Hash,
  Paperclip,
  Pencil,
  PhoneCall,
  Pin,
  Reply,
  SendHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "react-toastify"
import { Markdown } from "@/components/Markdown"
import { Modal } from "@/components/ui/Modal"
import { isRejoinFresh, readRejoin } from "@/lib/rejoinStore"
import { AttachmentCard } from "./AttachmentCard"
import { type LinkPreview, LinkPreviewCard } from "./LinkPreviewCard"

const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "👀"]
// How close two consecutive messages from the same sender have to be to
// share a header — same convention as Slack/Discord, so a message sent
// minutes or hours after the last one always gets its own visible time
// instead of silently joining a much older group.
const GROUP_WINDOW_MS = 5 * 60 * 1000

/** Hover-revealed send time for a grouped message — the header line (name +
 * timestamp) only renders for the first message in a run from the same
 * sender, so later messages in that run have no visible time otherwise. */
function GroupedTimestamp({ grouped, at }: { grouped: boolean; at: number }) {
  if (!grouped) return null
  return (
    <span className="-left-12 invisible absolute w-10 text-right text-[10px] text-base-content/40 group-hover:visible">
      {new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  )
}

type Attachment = { key: string; name: string; type: string; size: number }

type ChannelMessage = {
  id: string
  from: string
  fromName: string
  text: string
  at: number
  editedAt?: number
  replyToId?: string
  pinned?: boolean
  attachments?: Attachment[]
  linkPreview?: LinkPreview
  reactions: Record<string, { count: number; mine: boolean }>
  own: boolean
}

/**
 * A text channel, DM, or voice channel: the persistent conversation is the
 * room. History, sends, edits, deletes, reactions and pins all go through
 * the channel messages API (Postgres); a light poll keeps the view fresh —
 * none of this depends on being in the room's call, so it's the default
 * view for every channel kind, voice included. "Start a huddle" (DMs) and
 * "Join call" (voice channels) are the opt-in escalations into that
 * channel's own voice room.
 */
export function TextChannelView({
  room,
  slug,
  label,
  kind,
  canModerate,
}: {
  room: string
  slug: string
  /** Display label — #slug for channels, peer names for DMs. */
  label: string
  kind: "text" | "voice"
  canModerate: boolean
}) {
  const router = useRouter()
  // Chat is the default view for a voice channel, but a reload/revisit
  // while genuinely mid-call (a fresh rejoin proof left by RoomClient)
  // must resume the call, not strand the user on chat — mirrors
  // RoomClient's own rejoin-freshness check.
  const [resumingCall] = useState(() => {
    if (kind !== "voice" || typeof window === "undefined") return false
    return isRejoinFresh(readRejoin(room))
  })
  useEffect(() => {
    if (resumingCall) router.replace(`/c/${slug}?call=1`)
  }, [resumingCall, router, slug])
  const [messages, setMessages] = useState<ChannelMessage[] | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState<ChannelMessage | null>(null)
  const [replyTo, setReplyTo] = useState<ChannelMessage | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const markedRead = useRef(false)
  const [canAttach, setCanAttach] = useState(false)
  const [pending, setPending] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [lightbox, setLightbox] = useState<{
    url: string
    name: string
  } | null>(null)

  useEffect(() => {
    void fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCanAttach(Boolean(d?.features?.attachments)))
      .catch(() => {})
  }, [])

  const upload = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Files top out at 25MB.")
      return
    }
    setUploading(true)
    try {
      const res = await fetch(`/api/channels/${room}/attachments`, {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-file-name": file.name,
        },
        body: file,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.key) {
        toast.error(data?.error ?? "Upload failed.")
        return
      }
      setPending((prev) => [...prev, data as Attachment])
    } finally {
      setUploading(false)
    }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/${room}/messages`)
      if (res.status === 401) {
        window.location.href = `/auth/login?returnTo=${encodeURIComponent(
          window.location.pathname,
        )}`
        return
      }
      if (!res.ok) return
      const data = (await res.json()) as { messages: ChannelMessage[] }
      setMessages(data.messages)
      if (!markedRead.current) {
        markedRead.current = true
        void fetch(`/api/channels/${room}/read`, { method: "POST" }).catch(
          () => {},
        )
      }
    } catch {}
  }, [room])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [load])

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages drives the scroll
  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView()
  }, [messages])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if ((!text && pending.length === 0) || sending) return
    setSending(true)
    try {
      const res = editing
        ? await fetch(`/api/channels/${room}/messages/${editing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
          })
        : await fetch(`/api/channels/${room}/messages`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text,
              replyToId: replyTo?.id,
              ...(pending.length ? { attachments: pending } : {}),
            }),
          })
      if (!res.ok) {
        toast.error("Could not send the message.")
        return
      }
      setDraft("")
      setEditing(null)
      setReplyTo(null)
      setPending([])
      // Mark caught-up on your own send.
      void fetch(`/api/channels/${room}/read`, { method: "POST" }).catch(
        () => {},
      )
      await load()
    } finally {
      setSending(false)
    }
  }

  const react = async (m: ChannelMessage, emoji: string) => {
    await fetch(`/api/channels/${room}/messages/${m.id}/reactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emoji }),
    }).catch(() => {})
    await load()
  }

  const remove = async (m: ChannelMessage) => {
    const res = await fetch(`/api/channels/${room}/messages/${m.id}`, {
      method: "DELETE",
    }).catch(() => null)
    if (!res?.ok) toast.error("Could not delete the message.")
    await load()
  }

  const togglePin = async (m: ChannelMessage) => {
    await fetch(`/api/channels/${room}/messages/${m.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: !m.pinned }),
    }).catch(() => {})
    await load()
  }

  const byId = new Map((messages ?? []).map((m) => [m.id, m]))
  const pinned = (messages ?? []).filter((m) => m.pinned)

  if (resumingCall) {
    return (
      <main className="flex h-full items-center justify-center">
        <span className="loading loading-spinner" />
      </main>
    )
  }

  return (
    <main className="mx-auto flex h-full max-w-3xl flex-col px-4">
      <header className="flex items-center justify-between gap-3 border-base-300 border-b py-3">
        <span className="flex items-center gap-1 font-semibold">
          {label.startsWith("#") ? (
            <Hash className="size-4 text-base-content/60" />
          ) : (
            <Users className="size-4 text-base-content/60" />
          )}
          {label.replace(/^#/, "")}
        </span>
        {kind === "voice" ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            // Same tab: the call is this page's other state, not a side
            // conversation to escalate into (unlike a DM huddle).
            onClick={() => router.push(`/c/${slug}?call=1`)}
          >
            <PhoneCall className="size-4" />
            Join call
          </button>
        ) : (
          // Huddles are a DM escalation only — text channels stay text.
          !label.startsWith("#") && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              // The huddle opens in its own tab so the conversation stays put.
              onClick={() => window.open(`/c/${slug}?huddle=1`, "_blank")}
            >
              <PhoneCall className="size-4" />
              Start a huddle
            </button>
          )
        )}
      </header>

      {pinned.length > 0 && (
        <div className="border-base-300 border-b bg-base-200/30 px-2 py-1.5 text-xs">
          <Pin className="mr-1 inline size-3" />
          {pinned[pinned.length - 1].text.slice(0, 120)}
        </div>
      )}

      <ul
        className="flex-1 overflow-y-auto py-4"
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {messages === null ? (
          <li className="flex justify-center py-8">
            <span className="loading loading-spinner loading-sm" />
          </li>
        ) : messages.length === 0 ? (
          <li className="py-8 text-center text-base-content/50 text-sm">
            Nothing here yet — say something.
          </li>
        ) : (
          messages.map((m, i) => {
            const grouped =
              i > 0 &&
              messages[i - 1].from === m.from &&
              !m.replyToId &&
              m.at - messages[i - 1].at < GROUP_WINDOW_MS
            const parent = m.replyToId ? byId.get(m.replyToId) : undefined
            return (
              <li
                key={m.id}
                className={`group relative pl-12 ${grouped ? "mt-0.5" : "mt-3"}`}
              >
                <GroupedTimestamp grouped={grouped} at={m.at} />
                {parent && (
                  <div className="mb-0.5 border-primary/40 border-l-2 pl-2 text-base-content/50 text-xs">
                    <span className="font-medium">{parent.fromName}</span>:{" "}
                    {parent.text.slice(0, 80)}
                  </div>
                )}
                {!grouped && (
                  <div className="text-xs">
                    <span className="font-medium">{m.fromName}</span>
                    <span className="ml-2 text-base-content/40">
                      {new Date(m.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {m.editedAt && (
                      <span className="ml-1 text-base-content/40">
                        (edited)
                      </span>
                    )}
                    {m.pinned && (
                      <Pin className="ml-1 inline size-3 text-primary" />
                    )}
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    {m.text && <Markdown text={m.text} className="text-sm" />}
                    <LinkPreviewCard preview={m.linkPreview} />
                    {m.attachments?.map((a) =>
                      a.type.startsWith("image/") ? (
                        <button
                          key={a.key}
                          type="button"
                          className="mt-1 block cursor-zoom-in"
                          onClick={() =>
                            setLightbox({
                              url: `/api/channels/${room}/attachments?key=${encodeURIComponent(a.key)}`,
                              name: a.name,
                            })
                          }
                        >
                          <img
                            src={`/api/channels/${room}/attachments?key=${encodeURIComponent(a.key)}`}
                            alt={a.name}
                            className="max-h-64 max-w-full rounded-box"
                          />
                        </button>
                      ) : (
                        <AttachmentCard
                          key={a.key}
                          attachment={a}
                          href={`/api/channels/${room}/attachments?key=${encodeURIComponent(a.key)}`}
                        />
                      ),
                    )}
                  </span>
                  <span className="invisible flex shrink-0 items-center group-hover:visible">
                    {QUICK_EMOJI.slice(0, 3).map((e) => (
                      <button
                        key={e}
                        type="button"
                        className="btn btn-ghost btn-xs px-1"
                        onClick={() => void react(m, e)}
                      >
                        {e}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs px-1"
                      title="Reply"
                      onClick={() => {
                        setReplyTo(m)
                        setEditing(null)
                      }}
                    >
                      <Reply className="size-3.5" />
                    </button>
                    {m.own && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs px-1"
                        title="Edit"
                        onClick={() => {
                          setEditing(m)
                          setReplyTo(null)
                          setDraft(m.text)
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    {canModerate && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs px-1"
                        title={m.pinned ? "Unpin" : "Pin"}
                        onClick={() => void togglePin(m)}
                      >
                        <Pin className="size-3.5" />
                      </button>
                    )}
                    {(m.own || canModerate) && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs px-1"
                        title="Delete"
                        onClick={() => void remove(m)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </span>
                </div>
                {Object.keys(m.reactions).length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {Object.entries(m.reactions).map(([emoji, r]) => (
                      <button
                        key={emoji}
                        type="button"
                        className={`badge badge-sm cursor-pointer ${r.mine ? "badge-primary badge-soft" : "badge-ghost"}`}
                        onClick={() => void react(m, emoji)}
                      >
                        {emoji} {r.count}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })
        )}
        <div ref={bottomRef} />
      </ul>

      {(replyTo || editing) && (
        <div className="flex items-center justify-between rounded-t-box bg-base-200/60 px-3 py-1 text-xs">
          <span className="truncate">
            {editing
              ? "Editing message"
              : `Replying to ${replyTo?.fromName}: ${replyTo?.text.slice(0, 60)}`}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            onClick={() => {
              setReplyTo(null)
              setEditing(null)
              setDraft("")
            }}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {pending.map((a) => (
            <span key={a.key} className="badge badge-ghost gap-1">
              {a.type.startsWith("image/") ? (
                <img
                  src={`/api/channels/${room}/attachments?key=${encodeURIComponent(a.key)}`}
                  alt=""
                  className="size-4 rounded object-cover"
                />
              ) : (
                <Paperclip className="size-3" />
              )}
              {a.name}
              <button
                type="button"
                className="ml-1"
                onClick={() =>
                  setPending((prev) => prev.filter((p) => p.key !== a.key))
                }
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        onSubmit={send}
        className="flex items-center gap-2 border-base-300 border-t py-3"
      >
        {canAttach && !editing && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
                e.target.value = ""
              }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-square"
              title="Attach a file"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <Paperclip className="size-5" />
              )}
            </button>
          </>
        )}
        <input
          className="input w-full"
          placeholder={`Message ${label}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={(!draft.trim() && pending.length === 0) || sending}
        >
          {sending ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            <SendHorizontal className="size-5" />
          )}
        </button>
      </form>
      <Modal
        isOpen={lightbox !== null}
        onClose={() => setLightbox(null)}
        className="max-w-none bg-transparent p-0 shadow-none"
      >
        {lightbox && (
          <img
            src={lightbox.url}
            alt={lightbox.name}
            className="max-h-[85vh] max-w-[90vw] cursor-zoom-out rounded-box"
            onClick={() => setLightbox(null)}
          />
        )}
      </Modal>
    </main>
  )
}
