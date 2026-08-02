import { RoomClient } from "@/components/room/RoomClient"

type Params = { params: Promise<{ slug: string }> }

export default async function RoomPage({ params }: Params) {
  const { slug } = await params
  // Short-link base for Copy link (runtime env, e.g. https://lpd.sh/meet).
  const shareBase = process.env.SHARE_LINK_BASE?.replace(/\/$/, "")
  // Room components fill their parent (so channels can render calls inside
  // the app shell pane); standalone meetings get the full viewport here.
  return (
    <div className="h-dvh">
      <RoomClient slug={slug} shareBase={shareBase} />
    </div>
  )
}
