import { eq, getDb, schema, sql } from "@meet/db"
import { nanoid } from "nanoid"

export type InviteCheck =
  | { ok: true; role: "admin" | "member"; serverId: string }
  | { ok: false; reason: "not-found" | "revoked" | "expired" | "exhausted" }

function validate(invite: typeof schema.invites.$inferSelect): InviteCheck {
  if (invite.revokedAt) return { ok: false, reason: "revoked" }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" }
  }
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
    return { ok: false, reason: "exhausted" }
  }
  return {
    ok: true,
    role: invite.role as "admin" | "member",
    serverId: invite.serverId,
  }
}

export async function checkInvite(code: string): Promise<InviteCheck> {
  const invite = await getDb().query.invites.findFirst({
    where: eq(schema.invites.code, code),
  })
  if (!invite) return { ok: false, reason: "not-found" }
  return validate(invite)
}

export async function createInvite(opts: {
  serverId: string
  createdBy: string
  role: "admin" | "member"
  expiresInHours?: number
  maxUses?: number
}) {
  const [invite] = await getDb()
    .insert(schema.invites)
    .values({
      serverId: opts.serverId,
      code: nanoid(12),
      role: opts.role,
      createdBy: opts.createdBy,
      expiresAt: opts.expiresInHours
        ? new Date(Date.now() + opts.expiresInHours * 60 * 60 * 1000)
        : null,
      maxUses: opts.maxUses ?? null,
    })
    .returning()
  return invite
}

/**
 * Accept an invite as the signed-in user — the only way membership is ever
 * created (other than a server's creator becoming its owner). Runs in a
 * transaction with the invite row locked, so a last-use race can't
 * oversubscribe it. Joining an invite's server doesn't touch any other
 * server the user already belongs to.
 */
export async function redeemInvite(
  code: string,
  userId: string,
): Promise<InviteCheck> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.code, code))
      .for("update")
    if (!invite) return { ok: false, reason: "not-found" } as const
    const check = validate(invite)
    if (!check.ok) return check
    await tx
      .insert(schema.memberships)
      .values({ serverId: invite.serverId, userId, role: check.role })
      .onConflictDoNothing()
    await tx
      .update(schema.invites)
      .set({ useCount: sql`${schema.invites.useCount} + 1` })
      .where(eq(schema.invites.id, invite.id))
    return check
  })
}
