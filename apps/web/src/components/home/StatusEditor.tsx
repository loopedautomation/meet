"use client"

import { useState } from "react"

/** Set a custom status from the account menu ("in deep work", "back at 3").
 * Shown next to your name in the member directory. */
export function StatusEditor() {
  const [status, setStatus] = useState("")

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    await fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusText: status.trim() || null }),
    }).catch(() => {})
  }

  return (
    <li>
      <form onSubmit={save} className="p-0">
        <input
          className="input input-xs w-full"
          placeholder="Set a status…"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          onBlur={(e) => {
            if (e.target.value.trim())
              void save(e as unknown as React.FormEvent)
          }}
        />
      </form>
    </li>
  )
}
