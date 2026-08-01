import { pgErrorCode } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import {
  channelRoomName,
  createChannel,
  isValidChannelSlug,
  listChannelsForUser,
} from "@/lib/server/channels"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getMemberUser } from "@/lib/server/session"

const createChannelSchema = z.object({
  slug: z.string(),
  name: z.string().min(1).max(80).optional(),
  kind: z.enum(["voice", "text"]).optional(),
  topic: z.string().max(500).optional(),
  isPrivate: z.boolean().optional(),
})

/** The member's channel list with live occupancy — the sidebar's data. */
export async function GET() {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const channels = await listChannelsForUser(user.id)
  return NextResponse.json({
    channels: channels.map((c) => ({
      slug: c.slug,
      name: c.name,
      kind: c.kind,
      topic: c.topic,
      isPrivate: c.isPrivate,
      room: channelRoomName(c),
      occupants: c.occupants,
      occupantList: c.occupantList,
    })),
  })
}

/** Create a channel — admins and the owner. */
export async function POST(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  if (user.role === "member") {
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  }
  if (rateLimited(`channel-create:${clientKey(request)}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "too many channels, slow down" },
      { status: 429 },
    )
  }
  const body = createChannelSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!body.success || !isValidChannelSlug(body.data.slug)) {
    return NextResponse.json(
      {
        error:
          "slug must be 2-32 chars of lowercase letters, digits and hyphens",
      },
      { status: 400 },
    )
  }
  try {
    const channel = await createChannel({
      slug: body.data.slug,
      name: body.data.name ?? `#${body.data.slug}`,
      kind: body.data.kind,
      topic: body.data.topic,
      isPrivate: body.data.isPrivate,
      createdBy: user.id,
    })
    return NextResponse.json({
      slug: channel.slug,
      name: channel.name,
      room: channelRoomName(channel),
    })
  } catch (err) {
    // Unique violation on the slug — the only expected conflict.
    if (pgErrorCode(err) === "23505") {
      return NextResponse.json(
        { error: "a channel with that slug exists" },
        { status: 409 },
      )
    }
    throw err
  }
}
