import { and, desc, eq, getDb, schema, sql } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import {
  generateRegistrationToken,
  sha256Hex,
} from "@/lib/server/externalAgents"
import { getMemberUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

// Registration tokens for external agents (admin+): minted here, presented
// by agents to POST /api/agents/register. The plaintext is returned exactly
// once at creation; only its sha256 is ever stored, and no GET returns
// hashes or plaintext.

async function requireAdmin() {
  if (authMode() === "none") return null
  const user = await getMemberUser()
  if (!user || !user.serverId || user.role === "member") return null
  return user
}

/** Mint a token. The response is the only time the plaintext exists. */
export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user || !user.serverId)
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  const body = z
    .object({ label: z.string().max(120).optional() })
    .safeParse(await request.json().catch(() => ({})))
  if (!body.success)
    return NextResponse.json({ error: "invalid body" }, { status: 400 })
  const token = generateRegistrationToken()
  const [row] = await getDb()
    .insert(schema.agentRegistrationTokens)
    .values({
      serverId: user.serverId,
      tokenHash: sha256Hex(token),
      label: body.data.label ?? null,
      createdBy: user.id,
    })
    .returning()
  return NextResponse.json({ ok: true, id: row.id, token })
}

/** List tokens with the agent each one registered — never any hashes. */
export async function GET() {
  const user = await requireAdmin()
  if (!user || !user.serverId)
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  const rows = await getDb()
    .select({
      id: schema.agentRegistrationTokens.id,
      label: schema.agentRegistrationTokens.label,
      createdAt: schema.agentRegistrationTokens.createdAt,
      lastUsedAt: schema.agentRegistrationTokens.lastUsedAt,
      revokedAt: schema.agentRegistrationTokens.revokedAt,
      agentId: schema.externalAgents.id,
      agentName: schema.externalAgents.name,
    })
    .from(schema.agentRegistrationTokens)
    .leftJoin(
      schema.externalAgents,
      eq(
        schema.externalAgents.registrationTokenId,
        schema.agentRegistrationTokens.id,
      ),
    )
    .where(eq(schema.agentRegistrationTokens.serverId, user.serverId))
    .orderBy(desc(schema.agentRegistrationTokens.createdAt))
  return NextResponse.json({
    tokens: rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt.getTime(),
      lastUsedAt: r.lastUsedAt?.getTime() ?? null,
      revoked: Boolean(r.revokedAt),
      agent: r.agentId ? { id: r.agentId, name: r.agentName } : null,
    })),
  })
}

/** Revoke a token. The agent it registered stays until deleted explicitly —
 * revocation only stops future registrations and messages. */
export async function DELETE(request: Request) {
  const user = await requireAdmin()
  if (!user || !user.serverId)
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  const body = z
    .object({ id: z.string().uuid() })
    .safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "id required" }, { status: 400 })
  await getDb()
    .update(schema.agentRegistrationTokens)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(schema.agentRegistrationTokens.id, body.data.id),
        eq(schema.agentRegistrationTokens.serverId, user.serverId),
      ),
    )
  return NextResponse.json({ ok: true })
}
