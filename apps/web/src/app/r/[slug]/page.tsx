import { RoomClient } from "@/components/room/RoomClient"

type Params = { params: Promise<{ slug: string }> }

export default async function RoomPage({ params }: Params) {
  const { slug } = await params
  return <RoomClient slug={slug} />
}
