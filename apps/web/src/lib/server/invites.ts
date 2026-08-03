import { eq, getDb, schema, sql } from "@meet/db"
import { nanoid } from "nanoid"

export type InviteCheck =
  | { ok: true; role: "admin" | "member" }
  | { ok: false; reason: "not-found" | "revoked" | "expired" | "exhausted" }

function validate(invite: typeof schema.invites.$inferSelect): InviteCheck {
  if (invite.revokedAt) return { ok: false, reason: "revoked" }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" }
  }
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
    return { ok: false, reason: "exhausted" }
  }
  return { ok: true, role: invite.role as "admin" | "member" }
}

export async function checkInvite(code: string): Promise<InviteCheck> {
  const invite = await getDb().query.invites.findFirst({
    where: eq(schema.invites.code, code),
  })
  if (!invite) return { ok: false, reason: "not-found" }
  return validate(invite)
}

export async function createInvite(opts: {
  createdBy: string
  role: "admin" | "member"
  expiresInHours?: number
  maxUses?: number
}) {
  const [invite] = await getDb()
    .insert(schema.invites)
    .values({
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
 * created after the first-login owner bootstrap. Runs in a transaction with
 * the invite row locked, so a last-use race can't oversubscribe it.
 */
export async function redeemInvite(
  code: string,
  userId: string,
): Promise<InviteCheck | { ok: true; role: "admin" | "member" }> {
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
      .values({ userId, role: check.role })
      .onConflictDoNothing()
    await tx
      .update(schema.invites)
      .set({ useCount: sql`${schema.invites.useCount} + 1` })
      .where(eq(schema.invites.id, invite.id))
    return check
  })
}
