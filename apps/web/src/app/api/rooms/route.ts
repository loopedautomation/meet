import { NextResponse } from "next/server"
import { roomService } from "@/lib/server/livekit"
import { generateRoomSlug } from "@/lib/server/slug"

export async function POST(request: Request) {
  const slug = generateRoomSlug()
  await roomService().createRoom({
    name: slug,
    emptyTimeout: 300,
    departureTimeout: 60,
  })
  const url = new URL(`/r/${slug}`, request.url)
  return NextResponse.json({ slug, url: url.toString() })
}
