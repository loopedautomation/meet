"use client"

import { useState } from "react"
import { toast } from "react-toastify"
import { Modal } from "@/components/ui/Modal"

/**
 * Server creation — two-step Discord-style flow: "create your own" (v1
 * only offers this, no templates), then name + icon. Lands the caller
 * inside the new server via onCreated.
 */
export function CreateServerModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  onCreated: (defaultChannelSlug: string) => void
}) {
  const [step, setStep] = useState<"intro" | "customize">("intro")
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)

  const reset = () => {
    setStep("intro")
    setName("")
  }

  const close = () => {
    reset()
    onClose()
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned = name.trim()
    if (!cleaned) return
    setCreating(true)
    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: cleaned }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not create the server.")
        return
      }
      onCreated(data.defaultChannelSlug)
      close()
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close}>
      {step === "intro" ? (
        <>
          <h3 className="font-semibold text-lg">Create your server</h3>
          <p className="pt-1 text-base-content/60 text-sm">
            Your server is where you and your team hang out — its own channels,
            members and conversations.
          </p>
          <div className="flex flex-col gap-4 pt-4">
            <button
              type="button"
              className="btn btn-primary btn-brutalist justify-start"
              onClick={() => setStep("customize")}
            >
              Create my own
            </button>
          </div>
          <div className="modal-action">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={close}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <h3 className="font-semibold text-lg">Customize your server</h3>
          <p className="pt-1 text-base-content/60 text-sm">
            Give your new server a name. You can always change it later.
          </p>
          <form onSubmit={create} className="flex flex-col gap-4 pt-4">
            <label className="form-control">
              <span className="label-text pb-1 text-xs">Server name</span>
              <input
                autoFocus
                className="input input-sm w-full"
                placeholder="My team's server"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setStep("intro")}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm btn-brutalist"
                disabled={creating || !name.trim()}
              >
                {creating && (
                  <span className="loading loading-spinner loading-xs" />
                )}
                Create
              </button>
            </div>
          </form>
        </>
      )}
    </Modal>
  )
}
