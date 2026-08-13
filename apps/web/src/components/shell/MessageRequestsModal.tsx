"use client"

import { useEffect, useState } from "react"
import { toast } from "react-toastify"
import { Avatar } from "@/components/ui/Avatar"
import { Modal } from "@/components/ui/Modal"

type OtherUser = {
  id: string
  name: string | null
  email: string | null
  image: string | null
}
type RequestRow = { id: string; otherUser: OtherUser }

/**
 * The "Message requests" inbox — incoming requests to accept/decline, and
 * your own outgoing ones to cancel. Not inline in the DM list, not a toast:
 * its own dedicated surface, per #284.
 */
export function MessageRequestsModal({
  isOpen,
  onClose,
  onAccepted,
}: {
  isOpen: boolean
  onClose: () => void
  /** Called with the newly-opened DM's slug so the caller can navigate and
   * refresh the sidebar's channel list. */
  onAccepted: (slug: string) => void
}) {
  const [incoming, setIncoming] = useState<RequestRow[] | null>(null)
  const [outgoing, setOutgoing] = useState<RequestRow[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    const res = await fetch("/api/friend-requests").catch(() => null)
    const data = await res?.json().catch(() => null)
    if (res?.ok && data) {
      setIncoming(data.incoming)
      setOutgoing(data.outgoing)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload each time the modal opens, not on every render
  useEffect(() => {
    if (isOpen) void load()
  }, [isOpen])

  const accept = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/friend-requests/${id}/accept`, {
        method: "POST",
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.slug) {
        toast.error(data?.error ?? "Could not accept the request.")
        return
      }
      setIncoming((rows) => rows?.filter((r) => r.id !== id) ?? rows)
      onAccepted(data.slug)
    } finally {
      setBusyId(null)
    }
  }

  const decline = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/friend-requests/${id}/decline`, {
        method: "POST",
      })
      if (!res.ok) {
        toast.error("Could not decline the request.")
        return
      }
      setIncoming((rows) => rows?.filter((r) => r.id !== id) ?? rows)
    } finally {
      setBusyId(null)
    }
  }

  const cancel = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/friend-requests/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        toast.error("Could not cancel the request.")
        return
      }
      setOutgoing((rows) => rows?.filter((r) => r.id !== id) ?? rows)
    } finally {
      setBusyId(null)
    }
  }

  const label = (u: OtherUser) => u.name ?? u.email ?? "someone"

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h3 className="font-semibold text-lg">Message requests</h3>
      <div className="flex flex-col gap-5 pt-4">
        <section>
          <p className="pb-2 font-medium text-base-content/50 text-xs uppercase tracking-wide">
            Incoming
          </p>
          {incoming === null ? (
            <span className="loading loading-spinner loading-xs" />
          ) : incoming.length === 0 ? (
            <p className="text-base-content/50 text-sm">No pending requests.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {incoming.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <Avatar
                    name={label(r.otherUser)}
                    image={r.otherUser.image}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {label(r.otherUser)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary btn-xs"
                    disabled={busyId === r.id}
                    onClick={() => void accept(r.id)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={busyId === r.id}
                    onClick={() => void decline(r.id)}
                  >
                    Decline
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <p className="pb-2 font-medium text-base-content/50 text-xs uppercase tracking-wide">
            Sent
          </p>
          {outgoing === null ? null : outgoing.length === 0 ? (
            <p className="text-base-content/50 text-sm">Nothing pending.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {outgoing.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <Avatar
                    name={label(r.otherUser)}
                    image={r.otherUser.image}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {label(r.otherUser)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={busyId === r.id}
                    onClick={() => void cancel(r.id)}
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="modal-action">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </Modal>
  )
}
