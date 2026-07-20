import { NextResponse } from "next/server"
import { bridgeFetch } from "@/lib/server/bridge"
import { isValidRoomSlug } from "@/lib/server/slug"

type Params = { params: Promise<{ slug: string; id: string }> }

async function forward(
  method: "POST" | "DELETE",
  { params }: Params,
  body?: string,
) {
  const { slug, id } = await params
  if (!isValidRoomSlug(slug) || !/^[a-z0-9-]+$/.test(id)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 })
  }
  try {
    const res = await bridgeFetch(`/rooms/${slug}/agents/${id}`, {
      method,
      ...(body
        ? { body, headers: { "content-type": "application/json" } }
        : {}),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "bridge unavailable" }, { status: 502 })
  }
}

export async function POST(request: Request, ctx: Params) {
  const body = await request.text().catch(() => "")
  return forward("POST", ctx, body || undefined)
}

export async function DELETE(request: Request, ctx: Params) {
  return forward("DELETE", ctx)
}
