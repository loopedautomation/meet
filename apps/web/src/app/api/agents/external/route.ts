import { eq, getDb, schema, sql } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import {
  encryptToken,
  generateExternalAgentId,
  probeExternalAgent,
} from "@/lib/server/externalAgents"
import { getMemberUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

// Admin-pasted external agents: same durable "ext-…" agents as
// self-registration, minus the registration token — an admin pastes a TTY
// URL + token directly. Probing (SSRF policy + hello handshake) still goes
// through the bridge; the web tier never dials agent URLs.

const createSchema = z.object({
  url: z.string().min(1).max(500),
  token: z.string().max(500),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  voice: z.string().max(80).optional(),
})

async function requireAdmin() {
  if (authMode() === "none") return null
  const user = await getMemberUser()
  if (!user || user.role === "member") return null
  return user
}

/** List external agents for the admin console. URL host only — the full
 * URL path may embed secrets, and tokens (even encrypted) never leave. */
export async function GET() {
  const user = await requireAdmin()
  if (!user)
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  const rows = await getDb().select().from(schema.externalAgents)
  return NextResponse.json({
    agents: rows.map((a) => {
      let urlHost = ""
      try {
        urlHost = new URL(a.url).host
      } catch {}
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        urlHost,
        registered: Boolean(a.registrationTokenId),
        lastSeenAt: a.lastSeenAt?.getTime() ?? null,
      }
    }),
  })
}

export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user)
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  const body = createSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json(
      { error: "url and token required" },
      { status: 400 },
    )

  const probe = await probeExternalAgent(body.data.url, body.data.token)
  if (!probe.ok) {
    return NextResponse.json({ error: probe.error }, { status: probe.status })
  }
  const name = body.data.name?.trim() || probe.name
  const description = body.data.description?.trim() || probe.description || null

  const db = getDb()
  const [agent] = await db
    .insert(schema.externalAgents)
    .values({
      id: generateExternalAgentId(),
      name,
      description,
      url: probe.url,
      tokenCiphertext: encryptToken(body.data.token),
      voice: body.data.voice ?? null,
      registrationTokenId: null,
      createdBy: user.id,
      lastSeenAt: sql`now()`,
    })
    .returning()
  await db
    .insert(schema.serverAgents)
    .values({ agentId: agent.id, name, addedBy: user.id })
    .onConflictDoNothing()
  return NextResponse.json({ ok: true, agentId: agent.id, name })
}

/** Remove an external agent and its server-agent entry. Channel assignments
 * pointing at the id simply stop resolving, like an uninstalled registry
 * agent. */
export async function DELETE(request: Request) {
  const user = await requireAdmin()
  if (!user)
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  const body = z
    .object({ id: z.string().regex(/^ext-[0-9a-f]+$/) })
    .safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "id required" }, { status: 400 })
  const db = getDb()
  await db
    .delete(schema.externalAgents)
    .where(eq(schema.externalAgents.id, body.data.id))
  await db
    .delete(schema.serverAgents)
    .where(eq(schema.serverAgents.agentId, body.data.id))
  return NextResponse.json({ ok: true })
}
