"use client"

import { MessagesSquare } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { CreateServerModal } from "./CreateServerModal"

/**
 * The shell shown to a signed-in member who belongs to no server yet —
 * before they've created or joined their first one. Discord's equivalent
 * is landing straight in the create-server modal; we show a beat of
 * context first since there's no sidebar to fall back behind it.
 */
export function CreateServerOnboarding() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <MessagesSquare className="size-10 text-base-content/30" />
      <h1 className="font-semibold text-2xl">Create your first server</h1>
      <p className="max-w-md text-balance text-base-content/60">
        Your server is where you and your team hang out — its own channels,
        members and conversations. You can create as many as you need.
      </p>
      <button
        type="button"
        className="btn btn-primary btn-brutalist"
        onClick={() => setOpen(true)}
      >
        Create a server
      </button>
      <CreateServerModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onCreated={(defaultChannelSlug) => {
          router.push(`/c/${defaultChannelSlug}`)
          router.refresh()
        }}
      />
    </div>
  )
}
