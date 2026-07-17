"use client"

import type { CreateRoomResponse } from "@meet/shared"
import { ArrowRight, KeyRound, Video } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

const PASSWORD_KEY = "managementPassword"

export function HomeActions() {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  // Deployments with a management password gate meeting creation; the
  // password is remembered locally after the first successful use.
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState("")

  const createRoom = async (pw: string) => {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: pw ? { "x-management-password": pw } : {},
      })
      if (res.status === 401) {
        try {
          localStorage.removeItem(PASSWORD_KEY)
        } catch {}
        setNeedsPassword(true)
        if (pw) setError("Wrong management password.")
        setCreating(false)
        return
      }
      if (!res.ok) throw new Error(`room creation failed (${res.status})`)
      if (pw) {
        try {
          localStorage.setItem(PASSWORD_KEY, pw)
        } catch {}
      }
      const data = (await res.json()) as CreateRoomResponse
      router.push(`/r/${data.slug}`)
    } catch {
      setError("Could not create a meeting. Is the server configured?")
      setCreating(false)
    }
  }

  const handleNewMeeting = () => {
    let stored = ""
    try {
      stored = localStorage.getItem(PASSWORD_KEY) ?? ""
    } catch {}
    void createRoom(stored)
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
      {needsPassword && (
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault()
            if (password) void createRoom(password)
          }}
        >
          <label className="input join-item">
            <KeyRound className="size-4 text-base-content/50" />
            <input
              type="password"
              placeholder="Management password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary join-item"
            disabled={!password || creating}
          >
            Create
          </button>
        </form>
      )}
      {error && <p className="text-error text-sm">{error}</p>}
    </div>
  )
}
