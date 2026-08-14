import { notFound, redirect } from "next/navigation"
import { SettingsView } from "@/components/settings/SettingsView"
import { authMode } from "@/lib/server/authMode"
import { getSessionUser } from "@/lib/server/session"
import { storageConfigured } from "@/lib/server/storage"

export const dynamic = "force-dynamic"

/** Member settings — editable profile (display name + avatar override,
 * layered on the IdP-sourced identity), status, appearance. */
export default async function SettingsPage() {
  if (authMode() === "none") notFound()
  const user = await getSessionUser()
  if (!user) redirect("/auth/login?returnTo=/settings")
  if (!user.role) redirect("/")

  return (
    <SettingsView
      user={{
        name: user.name,
        email: user.email,
        image: user.image,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
      }}
      canUploadAvatar={storageConfigured()}
    />
  )
}
