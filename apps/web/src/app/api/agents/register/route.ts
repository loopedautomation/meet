import { eq, getDb, schema, sql } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import {
  encryptToken,
  generateExternalAgentId,
  probeExternalAgent,
  sha256Hex,
} from "@/lib/server/externalAgents"
import { rateLimited } from "@/lib/server/rateLimit"

export const dynamic = "force-dynamic"

// Self-registration for looped-af agents: an agent holding a registration
// token (minted by an admin at /api/admin/agent-tokens) announces its TTY
// URL here and becomes a durable server-level agent — DMable, addable to
// channels, listed in the roster. Re-registering with the same token updates
// the same agent in place (stable "ext-…" id), so assignments survive
// redeploys under a new URL.

const registerSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  url: z.string().min(1).max(500),
  token: z.string().max(500),
  voice: z.string().max(80).optional(),
})

export async function POST(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  // No session — auth is the bearer registration token itself.
  const auth = request.headers.get("authorization")
  const presented = auth?.match(/^Bearer (lreg_[0-9a-f]{32})$/)?.[1]
  if (!presented)
    return NextResponse.json({ error: "invalid token" }, { status: 401 })
  // Lookup is by sha256 of the presented token: fixed-length digest
  // comparison, so response timing never leaks token bytes.
  const tokenHash = sha256Hex(presented)
  if (rateLimited(`agent-register:${tokenHash}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 })
  }
  const db = getDb()
  const tokenRow = await db.query.agentRegistrationTokens.findFirst({
    where: eq(schema.agentRegistrationTokens.tokenHash, tokenHash),
  })
  if (!tokenRow || tokenRow.revokedAt) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 })
  }
  await db
    .update(schema.agentRegistrationTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(schema.agentRegistrationTokens.id, tokenRow.id))

  const body = registerSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json(
      { error: "url and token required" },
      { status: 400 },
    )

  // The bridge validates the URL (SSRF policy) and performs the TTY hello
  // handshake; the agent's own name/description fill any the body omitted.
  const probe = await probeExternalAgent(body.data.url, body.data.token)
  if (!probe.ok) {
    return NextResponse.json({ error: probe.error }, { status: probe.status })
  }
  const name = body.data.name?.trim() || probe.name
  const description = body.data.description?.trim() || probe.description || null

  // Machine-to-machine: attribution goes to the token's minter.
  const createdBy = tokenRow.createdBy
  const [agent] = await db
    .insert(schema.externalAgents)
    .values({
      id: generateExternalAgentId(),
      name,
      description,
      url: probe.url,
      tokenCiphertext: encryptToken(body.data.token),
      voice: body.data.voice ?? null,
      registrationTokenId: tokenRow.id,
      createdBy,
      lastSeenAt: sql`now()`,
    })
    // Keyed on the registration token: the same token always owns the same
    // agent row, and crucially the id is PRESERVED across re-registrations.
    .onConflictDoUpdate({
      target: schema.externalAgents.registrationTokenId,
      set: {
        name,
        description,
        url: probe.url,
        tokenCiphertext: encryptToken(body.data.token),
        voice: body.data.voice ?? null,
        updatedAt: sql`now()`,
        lastSeenAt: sql`now()`,
      },
    })
    .returning()

  // Registered agents are server agents — that's the point of registering.
  // Scoped to the token's server, matching where it was minted.
  await db
    .insert(schema.serverAgents)
    .values({
      serverId: tokenRow.serverId,
      agentId: agent.id,
      name,
      addedBy: createdBy,
    })
    .onConflictDoUpdate({
      target: [schema.serverAgents.serverId, schema.serverAgents.agentId],
      set: { name },
    })

  return NextResponse.json({ ok: true, agentId: agent.id, name })
}
