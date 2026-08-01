"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "react-toastify"

export function AcceptInvite({ code }: { code: string }) {
  const router = useRouter()
  const [accepting, setAccepting] = useState(false)

  const accept = async () => {
    setAccepting(true)
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(code)}`, {
        method: "POST",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not accept the invite.")
        setAccepting(false)
        return
      }
      router.push("/")
      router.refresh()
    } catch {
      toast.error("Could not accept the invite.")
      setAccepting(false)
    }
  }

  return (
    <button
      type="button"
      className="btn btn-primary btn-brutalist"
      onClick={() => void accept()}
      disabled={accepting}
    >
      {accepting && <span className="loading loading-spinner loading-sm" />}
      Accept invite
    </button>
  )
}
