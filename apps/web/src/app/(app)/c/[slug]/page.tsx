import { eq, getDb, inArray, schema } from "@meet/db"
import { notFound } from "next/navigation"
import { TextChannelView } from "@/components/channel/TextChannelView"
import { JoinChannelCall } from "@/components/shell/JoinChannelCall"
import { authMode } from "@/lib/server/authMode"
import { channelRoomName, getChannelBySlug } from "@/lib/server/channels"
import { getSessionUser } from "@/lib/server/session"

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ huddle?: string; call?: string }>
}

/**
 * A channel address: /c/standup. Every channel opens chat-first — text
 * channels, DMs, and voice channels alike — so chat is always readable and
 * usable without joining a call. ?huddle=1 flips a DM into its own voice
 * room (every DM has one — the escalation is just opening it); ?call=1 does
 * the same for a voice channel's own call. The human slug resolves to the
 * LiveKit room name (ch-<publicId>) so every in-room feature operates on
 * the room name exactly as meetings do. Access control happens in the
 * channel APIs; this page stays renderable so the login round-trip has
 * somewhere to return to.
 */
export default async function ChannelPage({ params, searchParams }: Props) {
  if (authMode() === "none") notFound()
  const [{ slug }, { huddle, call }] = await Promise.all([params, searchParams])
  const channel = await getChannelBySlug(slug)
  if (!channel || channel.archivedAt) notFound()
  const room = channelRoomName(channel)
  // Huddles are a DM escalation only — a plain text channel ignores the
  // huddle flag (voice belongs in voice channels).
  const huddleAllowed = channel.isDm && huddle === "1"
  const callAllowed = channel.kind === "voice" && call === "1"
  if (channel.kind === "text" && !huddleAllowed) {
    const user = await getSessionUser()
    let label = `#${channel.slug}`
    if (channel.isDm) {
      // A DM is labeled by the other people in it.
      const members = await getDb()
        .select({ userId: schema.channelMembers.userId })
        .from(schema.channelMembers)
        .where(eq(schema.channelMembers.channelId, channel.id))
      const otherIds = members
        .map((m) => m.userId)
        .filter((id) => id !== user?.id)
      const others = otherIds.length
        ? await getDb()
            .select({ name: schema.users.name, email: schema.users.email })
            .from(schema.users)
            .where(inArray(schema.users.id, otherIds))
        : []
      label =
        others.map((o) => o.name ?? o.email ?? "someone").join(", ") ||
        "Direct message"
    }
    return (
      <TextChannelView
        room={room}
        slug={channel.slug}
        label={label}
        kind="text"
        canModerate={user?.role === "owner" || user?.role === "admin"}
      />
    )
  }
  if (channel.kind === "voice" && !callAllowed) {
    const user = await getSessionUser()
    return (
      <TextChannelView
        room={room}
        slug={channel.slug}
        label={`#${channel.slug}`}
        kind="voice"
        canModerate={user?.role === "owner" || user?.role === "admin"}
      />
    )
  }
  return <JoinChannelCall room={room} channelSlug={channel.slug} />
}
