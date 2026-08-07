import { createPgClient } from "@meet/db"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import {
  canAccessChannel,
  channelRoomName,
  getChannelBySlug,
  listChannelsForUser,
} from "@/lib/server/channels"
import { onlineConnect, onlineDisconnect } from "@/lib/server/onlineRegistry"
import {
  MESSAGE_NOTIFY_CHANNEL,
  PRESENCE_NOTIFY_CHANNEL,
} from "@/lib/server/presence"
import { getMemberUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

/**
 * The sidebar's live wire: an SSE stream that pushes the member's channel
 * list (with occupants) on connect and whenever room_presence changes.
 * Backed by Postgres LISTEN/NOTIFY on a dedicated connection per stream —
 * webhook writers pg_notify, every stream wakes, each re-reads its own
 * visible channels (so private-channel access is enforced per viewer).
 * Debounced so a burst of joins costs one query.
 */
export async function GET() {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })

  const encoder = new TextEncoder()
  const listener = createPgClient()
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = async () => {
        if (closed) return
        try {
          const channels = await listChannelsForUser(user.id)
          const payload = channels.map((c) => ({
            slug: c.slug,
            name: c.name,
            kind: c.kind,
            topic: c.topic,
            isPrivate: c.isPrivate,
            isDm: c.isDm,
            dmPeers: c.dmPeers,
            unread: c.unread,
            room: channelRoomName(c),
            occupants: c.occupants,
            occupantList: c.occupantList,
          }))
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ channels: payload })}\n\n`,
            ),
          )
        } catch {
          // A transient query failure skips one update; the next notify or
          // heartbeat window retries.
        }
      }

      // Forward a chat_message_posted payload only if this viewer can see
      // the channel it came from — same rule listChannelsForUser applies
      // (public channels, or private/DM channels you're a member of).
      const forwardMessageIfVisible = async (raw: string) => {
        try {
          const { channelSlug } = JSON.parse(raw) as { channelSlug?: string }
          if (!channelSlug) return
          const channel = await getChannelBySlug(channelSlug)
          if (!channel || !(await canAccessChannel(channel, user.id))) return
          if (closed) return
          controller.enqueue(
            encoder.encode(`event: chat-message\ndata: ${raw}\n\n`),
          )
        } catch {
          // Malformed payload or a stream that closed mid-lookup — dropping
          // one notification is strictly better than leaking or throwing.
        }
      }

      onlineConnect(user.id)
      try {
        await listener.connect()
        listener.on("notification", (msg) => {
          // Chat messages get their own SSE event — no debounce, no channel
          // list re-read — distinct from the presence refresh below, which
          // batches bursts of joins/leaves. pg_notify fans out to *every*
          // stream, so this one has to gate on the viewer's own access
          // before forwarding: the payload carries a message snippet, and
          // DMs and private channels must not reach a non-member.
          if (msg.channel === MESSAGE_NOTIFY_CHANNEL) {
            if (closed || !msg.payload) return
            void forwardMessageIfVisible(msg.payload)
            return
          }
          if (debounce) return
          debounce = setTimeout(() => {
            debounce = null
            void send()
          }, 250)
        })
        listener.on("error", () => controller.close())
        await listener.query(`listen ${PRESENCE_NOTIFY_CHANNEL}`)
        await listener.query(`listen ${MESSAGE_NOTIFY_CHANNEL}`)
      } catch {
        controller.close()
        void listener.end().catch(() => {})
        return
      }

      await send()
      // Keep intermediaries from timing the stream out.
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"))
      }, 25_000)
    },
    cancel() {
      closed = true
      onlineDisconnect(user.id)
      if (heartbeat) clearInterval(heartbeat)
      if (debounce) clearTimeout(debounce)
      void listener.end().catch(() => {})
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}
