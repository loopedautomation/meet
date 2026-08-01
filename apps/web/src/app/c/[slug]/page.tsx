import { notFound } from "next/navigation"
import { TextChannelView } from "@/components/channel/TextChannelView"
import { RoomClient } from "@/components/room/RoomClient"
import { authMode } from "@/lib/server/authMode"
import { channelRoomName, getChannelBySlug } from "@/lib/server/channels"

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ huddle?: string }>
}

/**
 * A channel address: /c/standup. Voice channels open the room UI directly;
 * text channels open the conversation, with ?huddle=1 flipping into the
 * channel's own voice room (every text channel has one — the escalation is
 * just opening it). The human slug resolves to the LiveKit room name
 * (ch-<publicId>) so every in-room feature operates on the room name
 * exactly as meetings do. Access control happens in the channel APIs; this
 * page stays renderable so the login round-trip has somewhere to return to.
 */
export default async function ChannelPage({ params, searchParams }: Props) {
  if (authMode() === "none") notFound()
  const [{ slug }, { huddle }] = await Promise.all([params, searchParams])
  const channel = await getChannelBySlug(slug)
  if (!channel || channel.archivedAt) notFound()
  const room = channelRoomName(channel)
  if (channel.kind === "text" && huddle !== "1") {
    return <TextChannelView room={room} slug={channel.slug} />
  }
  return <RoomClient slug={room} mode="channel" />
}
