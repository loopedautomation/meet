"use client"

import type { ChatMessage } from "@meet/shared"
import { ArrowLeft, Hash, PhoneCall, SendHorizontal } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "react-toastify"
import { Wordmark } from "@/components/brand/BrandMark"
import { Markdown } from "@/components/Markdown"

/**
 * A text channel: the persistent conversation is the room. History and
 * sends go through the channel messages API (Postgres); a light poll keeps
 * the view fresh — the realtime upgrade (SSE/data-channel fan-out) comes
 * with the full Phase 2 message model. "Start a huddle" flips into the
 * channel's own voice room: every text channel already has one, the
 * Slack-huddle escalation is just opening it.
 */
export function TextChannelView({
  room,
  slug,
}: {
  room: string
  slug: string
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

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
      const data = (await res.json()) as { messages: ChatMessage[] }
      setMessages(data.messages)
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
    if (!text || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/channels/${room}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) {
        toast.error("Could not send the message.")
        return
      }
      setDraft("")
      await load()
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col px-4">
      <header className="flex items-center justify-between gap-3 border-base-300 border-b py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            title="Back to workspace"
            onClick={() => router.push("/")}
          >
            <ArrowLeft className="size-4" />
          </button>
          <span className="flex items-center gap-1 font-semibold">
            <Hash className="size-4 text-base-content/60" />
            {slug}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => router.push(`/c/${slug}?huddle=1`)}
          >
            <PhoneCall className="size-4" />
            Start a huddle
          </button>
          <span className="hidden sm:block">
            <Wordmark />
          </span>
        </div>
      </header>

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
            const grouped = i > 0 && messages[i - 1].from === m.from
            return (
              <li key={m.id} className={grouped ? "mt-0.5" : "mt-3"}>
                {!grouped && (
                  <div className="text-xs">
                    <span className="font-medium">{m.fromName}</span>
                    <span className="ml-2 text-base-content/40">
                      {new Date(m.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
                <Markdown text={m.text} className="text-sm" />
              </li>
            )
          })
        )}
        <div ref={bottomRef} />
      </ul>

      <form
        onSubmit={send}
        className="flex items-center gap-2 border-base-300 border-t py-3"
      >
        <input
          className="input w-full"
          placeholder={`Message #${slug}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!draft.trim() || sending}
        >
          {sending ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            <SendHorizontal className="size-5" />
          )}
        </button>
      </form>
    </main>
  )
}
