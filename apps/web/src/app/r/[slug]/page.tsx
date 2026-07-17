import { RoomClient } from "@/components/room/RoomClient"

type Params = { params: Promise<{ slug: string }> }

export default async function RoomPage({ params }: Params) {
  const { slug } = await params
  // Short-link base for Copy link (runtime env, e.g. https://lpd.sh/meet).
  const shareBase = process.env.SHARE_LINK_BASE?.replace(/\/$/, "")
  return <RoomClient slug={slug} shareBase={shareBase} />
}
