import { DesktopDragStrip } from "@/components/desktop/DesktopDragStrip"
import { RoomClient } from "@/components/room/RoomClient"

type Params = { params: Promise<{ slug: string }> }

export default async function RoomPage({ params }: Params) {
  const { slug } = await params
  // Short-link base for Copy link (runtime env, e.g. https://lpd.sh/meet).
  const shareBase = process.env.SHARE_LINK_BASE?.replace(/\/$/, "")
  // Room components fill their parent (so channels can render calls inside
  // the app shell pane); standalone meetings get the full viewport here.
  // Meeting links are a primary desktop deep-link target (main.js loads
  // them straight into the frameless main window), so this needs its own
  // drag strip same as (app)/layout.tsx.
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <DesktopDragStrip />
      <div className="min-h-0 flex-1">
        <RoomClient slug={slug} shareBase={shareBase} />
      </div>
    </div>
  )
}
