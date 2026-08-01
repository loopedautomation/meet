import { eq, getDb, schema, sql } from "@meet/db"
import { auth0 } from "./auth0"
import { authMode } from "./authMode"

// The session seam: every server-side consumer of "who is this request"
// goes through here, so a future identity swap (BYO OIDC, local accounts)
// touches this file and nothing else.

export type SessionUser = {
  /** users.id — the stable id LiveKit identities derive from (u_<id>). */
  id: string
  auth0Sub: string
  email: string | null
  name: string | null
  image: string | null
  /** null = authenticated but not a member (no invite accepted yet). */
  role: "owner" | "admin" | "member" | null
}

/**
 * Resolve the requesting user, or null when signed out (or when the
 * deployment runs without accounts). Upserts the users row so the profile
 * tracks the IdP, and claims the owner membership on the very first login
 * this instance ever sees. Membership is never created here otherwise —
 * joining is always the member's own action (an accepted invite).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (authMode() !== "auth0") return null
  const session = await auth0().getSession()
  if (!session?.user?.sub) return null
  const { sub, email, name, picture } = session.user
  const db = getDb()

  const [user] = await db
    .insert(schema.users)
    .values({
      auth0Sub: sub,
      email: email ?? null,
      name: name ?? null,
      image: picture ?? null,
    })
    .onConflictDoUpdate({
      target: schema.users.auth0Sub,
      set: {
        email: email ?? null,
        name: name ?? null,
        image: picture ?? null,
        updatedAt: sql`now()`,
      },
    })
    .returning()

  let membership = await db.query.memberships.findFirst({
    where: eq(schema.memberships.userId, user.id),
  })
  if (!membership) membership = await claimOwnerIfFirst(user.id)
  if (!membership) membership = await joinIfPublic(user.id)

  return {
    id: user.id,
    auth0Sub: user.auth0Sub,
    email: user.email,
    name: user.name,
    image: user.image,
    role: (membership?.role as SessionUser["role"]) ?? null,
  }
}

/** First login on a fresh instance claims the owner role. The insert is
 * guarded by "memberships is empty" inside a single statement, so two
 * concurrent first logins can't both win (the loser just stays a
 * non-member and needs an invite — visible, not corrupting). */
async function claimOwnerIfFirst(userId: string) {
  const db = getDb()
  const inserted = await db.execute(sql`
    insert into memberships (user_id, role)
    select ${userId}, 'owner'
    where not exists (select 1 from memberships)
    on conflict do nothing
    returning user_id, role, created_at
  `)
  if (inserted.rows.length === 0) return undefined
  return await db.query.memberships.findFirst({
    where: eq(schema.memberships.userId, userId),
  })
}

/** Public-server mode (Phase 3): when the instance's registration is
 * "open", signing in IS joining — still the member's own action, no invite
 * needed. Private (invite) instances never reach this. */
async function joinIfPublic(userId: string) {
  const db = getDb()
  const settings = await db.query.instanceSettings.findFirst()
  if (settings?.registration !== "open") return undefined
  await db
    .insert(schema.memberships)
    .values({ userId, role: "member" })
    .onConflictDoNothing()
  return await db.query.memberships.findFirst({
    where: eq(schema.memberships.userId, userId),
  })
}

/** Convenience for API routes: the session user only if they're a member. */
export async function getMemberUser(): Promise<SessionUser | null> {
  const user = await getSessionUser()
  return user?.role ? user : null
}
