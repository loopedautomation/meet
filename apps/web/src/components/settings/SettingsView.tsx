"use client"

import { LogOut, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { toast } from "react-toastify"
import { ThemeToggle } from "@/components/brand/ThemeToggle"

type SettingsUser = {
  name: string | null
  email: string | null
  image: string | null
  role: "owner" | "admin" | "member"
}

export function SettingsView({ user }: { user: SettingsUser }) {
  const [status, setStatus] = useState("")

  const saveStatus = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusText: status.trim() || null }),
    }).catch(() => null)
    if (res?.ok)
      toast.success(status.trim() ? "Status set." : "Status cleared.")
    else toast.error("Could not save your status.")
  }

  return (
    <main className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto px-6 pb-16">
      <header className="py-6">
        <h1 className="font-semibold text-xl">Settings</h1>
      </header>

      <section className="card card-border bg-base-200/20">
        <div className="card-body gap-4">
          <h2 className="card-title text-base">Profile</h2>
          <div className="flex items-center gap-4">
            {user.image ? (
              <img src={user.image} alt="" className="size-14 rounded-full" />
            ) : (
              <span className="flex size-14 items-center justify-center rounded-full bg-base-300 font-medium text-xl">
                {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
              </span>
            )}
            <div>
              <p className="font-medium">{user.name ?? "—"}</p>
              <p className="text-base-content/60 text-sm">{user.email}</p>
              <p className="text-base-content/40 text-xs capitalize">
                {user.role}
              </p>
            </div>
          </div>
          <p className="text-base-content/50 text-xs">
            Name, email and picture come from your identity provider — change
            them there and they follow on your next sign-in.
          </p>
        </div>
      </section>

      <section className="card card-border bg-base-200/20">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">Status</h2>
          <form onSubmit={saveStatus} className="flex max-w-sm gap-2">
            <input
              className="input input-sm flex-1"
              placeholder="In deep work, back at 3…"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            />
            <button type="submit" className="btn btn-sm btn-primary">
              Save
            </button>
          </form>
          <p className="text-base-content/50 text-xs">
            Shown next to your name across the server. Leave empty to clear.
          </p>
        </div>
      </section>

      <section className="card card-border bg-base-200/20">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">Appearance</h2>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <span className="text-sm">Switch between light and dark</span>
          </div>
        </div>
      </section>

      <section className="card card-border bg-base-200/20">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">Account</h2>
          <div className="flex flex-wrap gap-2">
            {(user.role === "owner" || user.role === "admin") && (
              <a href="/admin" className="btn btn-outline btn-sm">
                <ShieldCheck className="size-4" />
                Server admin
              </a>
            )}
            <a href="/auth/logout" className="btn btn-outline btn-sm">
              <LogOut className="size-4" />
              Sign out
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
