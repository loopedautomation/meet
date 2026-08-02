"use client"

import { Hash, Volume2 } from "lucide-react"
import { useState } from "react"
import { toast } from "react-toastify"
import { Modal } from "@/components/ui/Modal"

/** Channel creation (admins) — Discord-style modal. */
export function CreateChannelModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  onCreated: (slug: string) => void
}) {
  const [slug, setSlug] = useState("")
  const [kind, setKind] = useState<"voice" | "text">("text")
  const [topic, setTopic] = useState("")
  const [creating, setCreating] = useState(false)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned = slug.trim().toLowerCase()
    if (!cleaned) return
    setCreating(true)
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: cleaned,
          kind,
          ...(topic.trim() ? { topic: topic.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not create the channel.")
        return
      }
      setSlug("")
      setTopic("")
      onCreated(cleaned)
      onClose()
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h3 className="font-semibold text-lg">Create a channel</h3>
      <form onSubmit={create} className="flex flex-col gap-4 pt-4">
        <div className="flex flex-col gap-2">
          <span className="font-medium text-base-content/60 text-xs uppercase tracking-wide">
            Channel type
          </span>
          {(
            [
              {
                value: "text",
                icon: Hash,
                title: "Text",
                body: "Messages, files and threads",
              },
              {
                value: "voice",
                icon: Volume2,
                title: "Voice",
                body: "Hang out with voice, video and screen share",
              },
            ] as const
          ).map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-3 rounded-box border px-3 py-2 ${
                kind === opt.value
                  ? "border-primary bg-primary/10"
                  : "border-base-300 hover:bg-base-200"
              }`}
            >
              <input
                type="radio"
                name="channel-kind"
                className="radio radio-sm radio-primary"
                checked={kind === opt.value}
                onChange={() => setKind(opt.value)}
              />
              <opt.icon className="size-4 text-base-content/60" />
              <span className="flex flex-col">
                <span className="font-medium text-sm">{opt.title}</span>
                <span className="text-base-content/50 text-xs">{opt.body}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="form-control">
          <span className="label-text pb-1 text-xs">Channel name</span>
          <input
            className="input input-sm w-full"
            placeholder="new-channel"
            value={slug}
            maxLength={32}
            onChange={(e) => setSlug(e.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text pb-1 text-xs">Topic (optional)</span>
          <input
            className="input input-sm w-full"
            placeholder="What's this channel about?"
            value={topic}
            maxLength={500}
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        <div className="modal-action">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm btn-brutalist"
            disabled={creating || !slug.trim()}
          >
            {creating && (
              <span className="loading loading-spinner loading-xs" />
            )}
            Create channel
          </button>
        </div>
      </form>
    </Modal>
  )
}
