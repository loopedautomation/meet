import { NextResponse } from "next/server"
import { bridgeFetch } from "@/lib/server/bridge"
import { getSessionUser } from "@/lib/server/session"
import { isValidRoomSlug } from "@/lib/server/slug"

type Params = { params: Promise<{ slug: string }> }

// Mint a ticket for the desktop to dial the agent gateway.
// Auth: desktop session cookie (meet_desktop_session) — same as fetchChannels().
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params
  // Accept both 10-digit codes and human slugs like review-xyz (plan's roomSlug regex)
  if (!isValidRoomSlug(slug) && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    return NextResponse.json({ error: "invalid room" }, { status: 400 })
  }

  const user = await getSessionUser().catch(() => null)
  if (!user) {
    return NextResponse.json({ error: "not authorized" }, { status: 401 })
  }

  // Membership: any authenticated member can bring THEIR OWN local agent.
  // We don't gate on host — each user gets their own local-<id>.
  // If the deployment uses room-level admission, verifyParticipant would be the check,
  // but for the desktop-cookie path we have no LiveKit token; membership is database-level.
  // For now, any signed-in user with a valid session may mint; room existence is checked
  // implicitly by the bridge dispatch.

  try {
    const res = await bridgeFetch(`/rooms/${slug}/local-agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: user.id, userName: user.name ?? user.email ?? "Someone" }),
    })
    const data = (await res.json()) as { agentId?: string; ticket?: string; gatewayPath?: string; resumeToken?: string; error?: string }
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status })
    }
    // Build gatewayUrl from public env; fallback to ws://host:8093 for local dev.
    const gatewayPath = (data.gatewayPath ?? "/gateway/agent") as string
    let gatewayUrl: string
    const publicUrl = process.env.AGENT_GATEWAY_PUBLIC_URL
    if (publicUrl) {
      gatewayUrl = publicUrl.replace(/\/$/, "") + gatewayPath
    } else {
      // Derive from request host (http -> ws, https -> wss), port 8093
      const host = request.headers.get("host") ?? "localhost:3000"
      const proto = request.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https")
      const wsProto = proto === "https" ? "wss" : "ws"
      const hostname = host.split(":")[0]
      gatewayUrl = `${wsProto}://${hostname}:8093${gatewayPath}`
    }
    return NextResponse.json({
      agentId: data.agentId,
      ticket: data.ticket,
      resumeToken: data.resumeToken,
      gatewayUrl,
      gatewayPath,
    })
  } catch {
    return NextResponse.json({ error: "bridge unavailable" }, { status: 502 })
  }
}
