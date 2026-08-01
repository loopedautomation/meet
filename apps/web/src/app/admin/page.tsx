import { redirect } from "next/navigation"
import { AdminConsole } from "@/components/admin/AdminConsole"
import { authMode } from "@/lib/server/authMode"
import { getSessionUser } from "@/lib/server/session"

/** The instance admin console — owners and admins only. */
export default async function AdminPage() {
  if (authMode() === "none") redirect("/")
  const user = await getSessionUser()
  if (!user?.role || user.role === "member") redirect("/")
  return <AdminConsole isOwner={user.role === "owner"} selfId={user.id} />
}
