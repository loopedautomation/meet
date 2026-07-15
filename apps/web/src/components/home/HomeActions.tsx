"use client"

import type { CreateRoomResponse } from "@meet/shared"
import { ArrowRight, Video } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

export function HomeActions() {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)

  const handleNewMeeting = async () => {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/rooms", { method: "POST" })
      if (!res.ok) throw new Error(`room creation failed (${res.status})`)
      const data = (await res.json()) as CreateRoomResponse
      router.push(`/r/${data.slug}`)
    } catch {
      setError("Could not create a meeting. Is the server configured?")
      setCreating(false)
    }
  }

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault()
    const slug = code.trim().split("/").pop()
    if (slug) router.push(`/r/${slug}`)
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={handleNewMeeting}
          disabled={creating}
        >
          {creating ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            <Video className="size-5" />
          )}
          New meeting
        </button>
        <form onSubmit={handleJoin} className="join">
          <input
            className="input join-item input-lg w-56"
            placeholder="Enter a code or link"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-ghost join-item btn-lg"
            disabled={!code.trim()}
          >
            Join
            <ArrowRight className="size-4" />
          </button>
        </form>
      </div>
      {error && <p className="text-error text-sm">{error}</p>}
    </div>
  )
}
