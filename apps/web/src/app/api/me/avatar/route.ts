import { eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getSessionUser } from "@/lib/server/session"
import {
  MAX_AVATAR_BYTES,
  putAttachment,
  storageConfigured,
} from "@/lib/server/storage"

// Same self-serve gating as the sibling PATCH /api/me: authenticated
// (getSessionUser), not membership-gated. Each user's avatar lives at a
// fixed object key (overwritten in place on re-upload) rather than
// attachments' per-upload random key — there's only ever one "current"
// avatar per user, so there's nothing to track beyond that key.
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

function avatarKey(userId: string): string {
  return `avatar/${userId}`
}

/** Upload (or replace) your avatar. Raw image body; type via header. */
export async function POST(request: Request) {
  if (authMode() === "none" || !storageConfigured()) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const user = await getSessionUser()
  if (!user)
    return NextResponse.json({ error: "sign in first" }, { status: 401 })
  if (rateLimited(`avatar:${clientKey(request)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 })
  }
  const type = request.headers.get("content-type") ?? ""
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json(
      { error: "unsupported image type (png, jpeg, webp, gif only)" },
      { status: 415 },
    )
  }
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { error: "image too large (5MB max)" },
      { status: 413 },
    )
  }
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { error: "image too large (5MB max)" },
      { status: 413 },
    )
  }
  try {
    await putAttachment(avatarKey(user.id), bytes, type)
  } catch (err) {
    console.error("avatar upload failed", err)
    return NextResponse.json({ error: "storage unavailable" }, { status: 502 })
  }
  const avatarUrl = `/api/avatars/${user.id}`
  await getDb()
    .update(schema.users)
    .set({ avatarUrl })
    .where(eq(schema.users.id, user.id))
  return NextResponse.json({ avatarUrl })
}

/** Clear your avatar override — display reverts to the IdP picture. The
 * stored object is left in place (harmless, unreferenced once the column is
 * null) rather than adding a storage-delete path for a rare action. */
export async function DELETE() {
  if (authMode() === "none" || !storageConfigured()) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const user = await getSessionUser()
  if (!user)
    return NextResponse.json({ error: "sign in first" }, { status: 401 })
  await getDb()
    .update(schema.users)
    .set({ avatarUrl: null })
    .where(eq(schema.users.id, user.id))
  return NextResponse.json({ ok: true })
}
