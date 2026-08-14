"use client"

import { LogOut, Pencil, ShieldCheck, X } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "react-toastify"
import { ThemeToggle } from "@/components/brand/ThemeToggle"
import { SignOutLink } from "@/components/desktop/SignOutLink"

type SettingsUser = {
  /** Effective display name — override if set, else the IdP name. */
  name: string | null
  /** Always the raw IdP value. Never editable. */
  email: string | null
  /** Effective avatar — override if set, else the IdP picture. */
  image: string | null
  /** Raw override, or null if none is set. */
  displayName: string | null
  /** Raw override, or null if none is set. */
  avatarUrl: string | null
  role: "owner" | "admin" | "member"
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const ALLOWED_AVATAR_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

type MeResponse = {
  user?: {
    name: string | null
    image: string | null
    displayName: string | null
    avatarUrl: string | null
  } | null
}

export function SettingsView({
  user,
  canUploadAvatar,
}: {
  user: SettingsUser
  canUploadAvatar: boolean
}) {
  const [name, setName] = useState(user.name ?? "")
  const [savedName, setSavedName] = useState(user.name ?? "")
  const [hasNameOverride, setHasNameOverride] = useState(
    user.displayName !== null,
  )
  const [savingName, setSavingName] = useState(false)
  const [image, setImage] = useState(user.image)
  const [hasAvatarOverride, setHasAvatarOverride] = useState(
    user.avatarUrl !== null,
  )
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // After any mutation, re-read the effective values from the server rather
  // than guessing the fallback locally — the client never learns the raw
  // IdP name/picture, only whichever value is currently effective.
  const refetchMe = async () => {
    try {
      const res = await fetch("/api/me")
      if (!res.ok) return
      const data = (await res.json()) as MeResponse
      if (!data.user) return
      setName(data.user.name ?? "")
      setSavedName(data.user.name ?? "")
      setHasNameOverride(data.user.displayName !== null)
      setImage(data.user.image)
      setHasAvatarOverride(data.user.avatarUrl !== null)
    } catch {}
  }

  const nameDirty = name.trim() !== savedName.trim()

  const saveName = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("Display name can't be empty — use Reset instead.")
      return
    }
    setSavingName(true)
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: trimmed }),
      })
      if (!res.ok) throw new Error("save failed")
      setSavedName(trimmed)
      setHasNameOverride(true)
      toast.success("Display name updated.")
    } catch {
      toast.error("Couldn't save your display name — try again.")
    } finally {
      setSavingName(false)
    }
  }

  const resetName = async () => {
    setSavingName(true)
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: null }),
      })
      if (!res.ok) throw new Error("reset failed")
      await refetchMe()
      toast.success("Reverted to your identity provider's name.")
    } catch {
      toast.error("Couldn't reset your display name — try again.")
    } finally {
      setSavingName(false)
    }
  }

  const uploadAvatar = async (file: File) => {
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("Images top out at 5MB.")
      return
    }
    if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
      toast.error("Use a PNG, JPEG, WebP or GIF image.")
      return
    }
    setUploadingAvatar(true)
    try {
      const res = await fetch("/api/me/avatar", {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      })
      if (!res.ok) throw new Error("upload failed")
      const data = (await res.json()) as { avatarUrl: string }
      // Cache-bust: the avatar lives at a fixed URL per user, so a re-upload
      // needs a fresh query param or the browser (and other open tabs) keep
      // showing the previous cached image.
      setImage(`${data.avatarUrl}?v=${Date.now()}`)
      setHasAvatarOverride(true)
      toast.success("Avatar updated.")
    } catch {
      toast.error("Couldn't upload that image — try again.")
    } finally {
      setUploadingAvatar(false)
    }
  }

  const removeAvatar = async () => {
    setUploadingAvatar(true)
    try {
      const res = await fetch("/api/me/avatar", { method: "DELETE" })
      if (!res.ok) throw new Error("remove failed")
      await refetchMe()
      toast.success("Reverted to your identity provider's picture.")
    } catch {
      toast.error("Couldn't remove your avatar — try again.")
    } finally {
      setUploadingAvatar(false)
    }
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
            <div className="relative">
              {image ? (
                <img
                  src={image}
                  alt=""
                  className="size-14 rounded-full object-cover"
                />
              ) : (
                <span className="flex size-14 items-center justify-center rounded-full bg-base-300 font-medium text-xl">
                  {(name || user.email || "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              {canUploadAvatar && (
                <button
                  type="button"
                  disabled={uploadingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-circle btn-neutral btn-xs absolute right-0 bottom-0"
                  aria-label="Change avatar"
                >
                  <Pencil className="size-3" />
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (file) void uploadAvatar(file)
                }}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder="Display name"
                  className="input input-sm w-full max-w-xs"
                />
                {nameDirty && (
                  <button
                    type="button"
                    disabled={savingName}
                    onClick={() => void saveName()}
                    className="btn btn-primary btn-sm"
                  >
                    Save
                  </button>
                )}
                {hasNameOverride && !nameDirty && (
                  <button
                    type="button"
                    disabled={savingName}
                    onClick={() => void resetName()}
                    title="Reset to identity provider name"
                    className="btn btn-ghost btn-sm btn-square"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="text-base-content/60 text-sm">{user.email}</p>
              <p className="text-base-content/40 text-xs capitalize">
                {user.role}
              </p>
            </div>
          </div>
          {canUploadAvatar && hasAvatarOverride && (
            <button
              type="button"
              disabled={uploadingAvatar}
              onClick={() => void removeAvatar()}
              className="btn btn-ghost btn-xs w-fit"
            >
              Remove custom avatar
            </button>
          )}
          <p className="text-base-content/50 text-xs">
            Your display name and{canUploadAvatar ? " avatar" : ""} are editable
            here.{" "}
            {!canUploadAvatar &&
              "Avatar uploads aren't available on this server. "}
            Email always comes from your identity provider and can't be changed
            here.
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
            <SignOutLink className="btn btn-outline btn-sm">
              <LogOut className="size-4" />
              Sign out
            </SignOutLink>
          </div>
        </div>
      </section>
    </main>
  )
}
