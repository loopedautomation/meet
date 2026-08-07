import { and, eq, getDb, schema, sql } from "@meet/db"
import { cookies } from "next/headers"
import { auth0 } from "./auth0"
import { authMode } from "./authMode"
import {
  DESKTOP_SESSION_COOKIE,
  validateDesktopSession,
} from "./desktopSession"

// The session seam: every server-side consumer of "who is this request"
// goes through here, so a future identity swap (BYO OIDC, local accounts)
// touches this file and nothing else.

/** Which server "role"/"serverId" below refer to — the member's last
 * visited server, remembered across sessions so switching sticks. */
export const ACTIVE_SERVER_COOKIE = "meet_active_server"

export type SessionUser = {
  /** users.id — the stable id LiveKit identities derive from (u_<id>). */
  id: string
  auth0Sub: string
  email: string | null
  name: string | null
  image: string | null
  /** Presence indicator the member picked (active | away | dnd). */
  presence: string
  /** The member's active server (see ACTIVE_SERVER_COOKIE) — null when
   * they belong to no server yet (fresh account, hasn't created/joined one). */
  serverId: string | null
  /** Role on the active server. null = no active server, or authenticated
   * but not a member of it. Membership is never auto-created here — joining
   * is always the member's own action (create a server, or accept an
   * invite). */
  role: "owner" | "admin" | "member" | null
}

/**
 * Resolve the requesting user, or null when signed out (or when the
 * deployment runs without accounts). Upserts the users row so the profile
 * tracks the IdP, and resolves their role on the "active server" (the one
 * the sidebar/URL last pointed at, tracked by ACTIVE_SERVER_COOKIE, falling
 * back to whichever server they joined first).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (authMode() !== "auth0") return null

  // Desktop shell branch: an opaque cookie backed by desktop_sessions,
  // minted by the browser-handoff sign-in. The user row already exists
  // (created during the browser login), so no upsert here.
  const desktopToken = (await cookies()).get(DESKTOP_SESSION_COOKIE)?.value
  if (desktopToken) {
    const user = await validateDesktopSession(desktopToken)
    if (user) {
      const active = await resolveActiveMembership(user.id)
      return {
        id: user.id,
        auth0Sub: user.auth0Sub,
        email: user.email,
        name: user.name,
        image: user.image,
        presence: user.presence,
        serverId: active?.serverId ?? null,
        role: active?.role ?? null,
      }
    }
  }

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

  const active = await resolveActiveMembership(user.id)

  return {
    id: user.id,
    auth0Sub: user.auth0Sub,
    email: user.email,
    name: user.name,
    image: user.image,
    presence: user.presence,
    serverId: active?.serverId ?? null,
    role: active?.role ?? null,
  }
}

/** The member's active server: whichever ACTIVE_SERVER_COOKIE names, if
 * they still belong to it, else the server they joined first, else null
 * (no servers at all — the onboarding/create-server state). */
async function resolveActiveMembership(
  userId: string,
): Promise<{ serverId: string; role: "owner" | "admin" | "member" } | null> {
  const db = getDb()
  const cookieServerId = (await cookies()).get(ACTIVE_SERVER_COOKIE)?.value

  if (cookieServerId) {
    const membership = await db.query.memberships.findFirst({
      where: and(
        eq(schema.memberships.serverId, cookieServerId),
        eq(schema.memberships.userId, userId),
      ),
    })
    if (membership) {
      return {
        serverId: membership.serverId,
        role: membership.role as "owner" | "admin" | "member",
      }
    }
  }

  const first = await db.query.memberships.findFirst({
    where: eq(schema.memberships.userId, userId),
    orderBy: (m, { asc }) => asc(m.createdAt),
  })
  if (!first) return null
  return {
    serverId: first.serverId,
    role: first.role as "owner" | "admin" | "member",
  }
}

/** Convenience for API routes: the session user only if they're a member
 * of an active server. */
export async function getMemberUser(): Promise<SessionUser | null> {
  const user = await getSessionUser()
  return user?.role && user.serverId ? user : null
}
