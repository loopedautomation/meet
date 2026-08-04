import { eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { bridgeFetch } from "@/lib/server/bridge"
import { getMemberUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

const agentIdSchema = z.object({ agentId: z.string().regex(/^[a-z0-9-]+$/) })

/** Agents invited to this server — the DM picker's agent section. */
export async function GET() {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  const agents = await getDb().select().from(schema.serverAgents)
  return NextResponse.json({
    agents: agents.map((a) => ({ id: a.agentId, name: a.name ?? a.agentId })),
  })
}

/** Invite an agent to the server (admin+). It becomes DMable, addable to
 * group chats, and shows in the directory; meeting rooms already offer the
 * whole registry roster automatically. */
export async function POST(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user || user.role === "member") {
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  }
  const body = agentIdSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "agentId required" }, { status: 400 })
  // Must exist in the bridge's registry — the invite snapshots its name.
  let name: string | null = null
  try {
    const res = await bridgeFetch("/agents")
    const roster = (await res.json()) as {
      agents?: { id: string; name?: string }[]
    }
    const entry = roster.agents?.find((a) => a.id === body.data.agentId)
    if (!entry)
      return NextResponse.json({ error: "unknown agent" }, { status: 404 })
    name = entry.name ?? null
  } catch {
    return NextResponse.json({ error: "bridge unavailable" }, { status: 502 })
  }
  await getDb()
    .insert(schema.serverAgents)
    .values({ agentId: body.data.agentId, name, addedBy: user.id })
    .onConflictDoNothing()
  return NextResponse.json({ ok: true })
}

/** Uninvite (admin+). Channel assignments cascade separately — removing
 * from the server doesn't silently pull an agent out of channels. */
export async function DELETE(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user || user.role === "member") {
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  }
  const body = agentIdSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "agentId required" }, { status: 400 })
  await getDb()
    .delete(schema.serverAgents)
    .where(eq(schema.serverAgents.agentId, body.data.agentId))
  return NextResponse.json({ ok: true })
}
