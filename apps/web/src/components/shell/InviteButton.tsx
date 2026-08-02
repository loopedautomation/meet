"use client"

import { UserPlus } from "lucide-react"
import { useState } from "react"
import { toast } from "react-toastify"

/** One-click invite link: mints a member invite and puts the URL on the
 * clipboard. The full invite management surface lives in /admin. */
export function InviteButton() {
  const [busy, setBusy] = useState(false)

  const invite = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "member" }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        toast.error(data?.error ?? "Could not mint the invite.")
        return
      }
      await navigator.clipboard.writeText(data.url).catch(() => {})
      toast.success("Invite link copied to your clipboard.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className="btn btn-primary btn-brutalist"
      disabled={busy}
      onClick={() => void invite()}
    >
      {busy ? (
        <span className="loading loading-spinner loading-xs" />
      ) : (
        <UserPlus className="size-4" />
      )}
      Invite people
    </button>
  )
}
