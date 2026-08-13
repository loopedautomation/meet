import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { getMemberUser } from "@/lib/server/session"
import { getAttachment, storageConfigured } from "@/lib/server/storage"

type Params = { params: Promise<{ userId: string }> }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Stream a member's uploaded avatar. Visible to any signed-in member —
 * avatars show up instance-wide (member lists, DMs, messages), not scoped
 * to a single channel like attachments are. */
export async function GET(_request: Request, { params }: Params) {
  if (authMode() === "none" || !storageConfigured()) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const viewer = await getMemberUser()
  if (!viewer)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const { userId } = await params
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const object = await getAttachment(`avatar/${userId}`)
  if (!object) return NextResponse.json({ error: "not found" }, { status: 404 })
  return new Response(object.body, {
    headers: {
      "content-type": object.contentType,
      ...(object.contentLength
        ? { "content-length": String(object.contentLength) }
        : {}),
      "content-disposition": "inline",
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  })
}
