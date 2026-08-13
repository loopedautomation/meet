import { eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { getSessionUser } from "@/lib/server/session"
import { storageConfigured } from "@/lib/server/storage"

export const dynamic = "force-dynamic"

const patchSchema = z.object({
  statusText: z.string().max(80).nullable().optional(),
  presence: z.enum(["active", "away", "dnd"]).optional(),
  // Local display-name override — null clears it, reverting display to the
  // raw IdP name (see effectiveUserName in packages/db/src/schema.ts).
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
})

/** Set your presence indicator, custom status text, or profile overrides
 * (display name). Email is never editable here or anywhere — always the raw
 * IdP value. Avatar upload is a separate endpoint, /api/me/avatar. */
export async function PATCH(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser()
  if (!user)
    return NextResponse.json({ error: "sign in first" }, { status: 401 })
  const body = patchSchema.safeParse(await request.json().catch(() => null))
  if (!body.success || Object.keys(body.data).length === 0)
    return NextResponse.json({ error: "invalid status" }, { status: 400 })
  await getDb()
    .update(schema.users)
    .set({
      ...(body.data.statusText !== undefined
        ? { statusText: body.data.statusText }
        : {}),
      ...(body.data.presence ? { presence: body.data.presence } : {}),
      ...(body.data.displayName !== undefined
        ? { displayName: body.data.displayName }
        : {}),
    })
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
    features: {
      attachments: storageConfigured(),
      avatarUpload: storageConfigured(),
    },
    user: user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          role: user.role,
          presence: user.presence,
        }
      : null,
  })
}
