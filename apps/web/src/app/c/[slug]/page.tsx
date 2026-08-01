import { notFound } from "next/navigation"
import { RoomClient } from "@/components/room/RoomClient"
import { authMode } from "@/lib/server/authMode"
import { channelRoomName, getChannelBySlug } from "@/lib/server/channels"

type Params = { params: Promise<{ slug: string }> }

/**
 * A channel address: /c/standup. Resolves the human slug to the channel's
 * LiveKit room name (ch-<publicId>) so every in-room feature — agents, doc,
 * whiteboard, settings — operates on the room name exactly as meetings do.
 * Access control happens in the channel token route; this page stays
 * renderable so the login round-trip has somewhere to return to.
 */
export default async function ChannelPage({ params }: Params) {
  if (authMode() === "none") notFound()
  const { slug } = await params
  const channel = await getChannelBySlug(slug)
  if (!channel || channel.archivedAt) notFound()
  return <RoomClient slug={channelRoomName(channel)} mode="channel" />
}
