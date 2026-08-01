import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { getSessionUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

/** Who am I on this instance — session + membership in one call. */
export async function GET() {
  const mode = authMode()
  if (mode === "none") return NextResponse.json({ authMode: mode, user: null })
  const user = await getSessionUser()
  return NextResponse.json({
    authMode: mode,
    user: user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        }
      : null,
  })
}
