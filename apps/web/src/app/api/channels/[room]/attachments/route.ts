import { customAlphabet } from "nanoid"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { canAccessChannel, getChannelByRoomName } from "@/lib/server/channels"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getMemberUser } from "@/lib/server/session"
import {
  getAttachment,
  MAX_ATTACHMENT_BYTES,
  putAttachment,
  storageConfigured,
} from "@/lib/server/storage"

type Params = { params: Promise<{ room: string }> }

const objectId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10)

function sanitizeName(name: string): string {
  return (
    name
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "file"
  )
}

/** Upload an attachment (raw body; name/type via headers). The object key
 * is namespaced by channel, and downloads re-check membership — a key
 * alone never grants access. */
export async function POST(request: Request, { params }: Params) {
  if (authMode() === "none" || !storageConfigured()) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const { room } = await params
  const channel = await getChannelByRoomName(room)
  if (!channel || !(await canAccessChannel(channel, user.id))) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 })
  }
  if (rateLimited(`attach:${clientKey(request)}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 })
  }
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json(
      { error: "file too large (25MB max)" },
      { status: 413 },
    )
  }
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json(
      { error: "file too large (25MB max)" },
      { status: 413 },
    )
  }
  const name = sanitizeName(request.headers.get("x-file-name") ?? "file")
  const type = request.headers.get("content-type") ?? "application/octet-stream"
  const key = `att/${channel.publicId}/${objectId()}/${name}`
  try {
    await putAttachment(key, bytes, type)
  } catch (err) {
    console.error("attachment upload failed", err)
    return NextResponse.json({ error: "storage unavailable" }, { status: 502 })
  }
  return NextResponse.json({ key, name, type, size: bytes.byteLength })
}

/** Stream an attachment back — membership-checked, key must belong to this
 * channel's namespace. Served same-origin so inline images work under the
 * app's COEP policy without bucket CORS/CORP config. */
export async function GET(request: Request, { params }: Params) {
  if (authMode() === "none" || !storageConfigured()) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const { room } = await params
  const channel = await getChannelByRoomName(room)
  if (!channel || !(await canAccessChannel(channel, user.id))) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 })
  }
  const key = new URL(request.url).searchParams.get("key") ?? ""
  if (!key.startsWith(`att/${channel.publicId}/`) || key.includes("..")) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const object = await getAttachment(key)
  if (!object) return NextResponse.json({ error: "not found" }, { status: 404 })
  const inline = /^(image|video|audio)\//.test(object.contentType)
  return new Response(object.body, {
    headers: {
      "content-type": object.contentType,
      ...(object.contentLength
        ? { "content-length": String(object.contentLength) }
        : {}),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${key.split("/").pop()}"`,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  })
}
