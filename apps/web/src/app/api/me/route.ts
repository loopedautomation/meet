import { eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { getSessionUser } from "@/lib/server/session"
import { storageConfigured } from "@/lib/server/storage"

export const dynamic = "force-dynamic"

const patchSchema = z.object({ statusText: z.string().max(80).nullable() })

/** Set your custom status ("in deep work", "back at 3"). */
export async function PATCH(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser()
  if (!user)
    return NextResponse.json({ error: "sign in first" }, { status: 401 })
  const body = patchSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "invalid status" }, { status: 400 })
  await getDb()
    .update(schema.users)
    .set({ statusText: body.data.statusText })
    .where(eq(schema.users.id, user.id))
  return NextResponse.json({ ok: true })
}

/** Who am I on this instance — session + membership in one call. */
export async function GET() {
  const mode = authMode()
  if (mode === "none") return NextResponse.json({ authMode: mode, user: null })
  const user = await getSessionUser()
  return NextResponse.json({
    authMode: mode,
    features: { attachments: storageConfigured() },
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
