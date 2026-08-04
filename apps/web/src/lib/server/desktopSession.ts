import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { and, eq, getDb, isNull, schema, sql } from "@meet/db"

// Desktop shell sign-in: the browser completes the Auth0 login, the shell
// gets a one-time code (deep link or paste) and exchanges it — together with
// the PKCE-style verifier it kept locally — for a meet_desktop_session
// cookie backed by the desktop_sessions table. The web session stays the
// Auth0 SDK cookie; this parallel store exists so devices are individually
// revocable (logout, admin removal, GDPR purge via FK cascade).

export const DESKTOP_SESSION_COOKIE = "meet_desktop_session"

const CODE_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** lastSeenAt/expiresAt are only bumped when this stale — one write per
 * few minutes per device, not per request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

export function sha256b64url(value: string): string {
  return createHash("sha256").update(value).digest("base64url")
}

function newSecret(): string {
  return randomBytes(32).toString("base64url")
}

/** Shell → server: park a pending request keyed by the verifier's hash. */
export async function startAuthRequest(challenge: string) {
  const [request] = await getDb()
    .insert(schema.desktopAuthRequests)
    .values({ challenge, expiresAt: new Date(Date.now() + CODE_TTL_MS) })
    .returning()
  return request
}

/**
 * Browser (signed-in member) → server: attach the user and mint the
 * one-time code. First approval wins — the code is only minted while
 * codeHash is null, so reloading the page can't re-key the request.
 */
export async function approveAuthRequest(
  requestId: string,
  userId: string,
): Promise<{ ok: true; code: string } | { ok: false }> {
  const db = getDb()
  const code = newSecret()
  return await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(schema.desktopAuthRequests)
      .where(eq(schema.desktopAuthRequests.id, requestId))
      .for("update")
    if (
      !request ||
      request.codeHash !== null ||
      request.consumedAt !== null ||
      request.expiresAt.getTime() < Date.now()
    ) {
      return { ok: false } as const
    }
    await tx
      .update(schema.desktopAuthRequests)
      .set({ codeHash: sha256b64url(code), userId })
      .where(eq(schema.desktopAuthRequests.id, requestId))
    return { ok: true, code } as const
  })
}

/**
 * Shell → server: exchange code + verifier for a session token (the cookie
 * value). Single-use under a row lock, TTL-bound, and the verifier must
 * hash to the challenge the flow started with — a leaked deep-link code is
 * useless without the verifier, which never left the shell.
 */
export async function redeemAuthCode(
  code: string,
  verifier: string,
  deviceName: string | null,
): Promise<{ ok: true; token: string; userId: string } | { ok: false }> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(schema.desktopAuthRequests)
      .where(eq(schema.desktopAuthRequests.codeHash, sha256b64url(code)))
      .for("update")
    if (
      !request?.userId ||
      request.consumedAt !== null ||
      request.expiresAt.getTime() < Date.now()
    ) {
      return { ok: false } as const
    }
    const expected = Buffer.from(request.challenge)
    const presented = Buffer.from(sha256b64url(verifier))
    if (
      expected.length !== presented.length ||
      !timingSafeEqual(expected, presented)
    ) {
      return { ok: false } as const
    }
    await tx
      .update(schema.desktopAuthRequests)
      .set({ consumedAt: sql`now()` })
      .where(eq(schema.desktopAuthRequests.id, request.id))
    const token = newSecret()
    await tx.insert(schema.desktopSessions).values({
      tokenHash: sha256b64url(token),
      userId: request.userId,
      deviceName,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    return { ok: true, token, userId: request.userId } as const
  })
}

/** Cookie → user row, or null. Slides the expiry on activity (throttled). */
export async function validateDesktopSession(token: string) {
  const db = getDb()
  const now = Date.now()
  const rows = await db
    .select({
      session: schema.desktopSessions,
      user: schema.users,
    })
    .from(schema.desktopSessions)
    .innerJoin(schema.users, eq(schema.desktopSessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.desktopSessions.tokenHash, sha256b64url(token)),
        isNull(schema.desktopSessions.revokedAt),
      ),
    )
  const row = rows[0]
  if (!row || row.session.expiresAt.getTime() < now) return null
  if (now - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(schema.desktopSessions)
      .set({
        lastSeenAt: sql`now()`,
        expiresAt: new Date(now + SESSION_TTL_MS),
      })
      .where(eq(schema.desktopSessions.id, row.session.id))
  }
  return row.user
}

/** Logout: revoke the session behind this cookie value. */
export async function revokeDesktopSession(token: string) {
  await getDb()
    .update(schema.desktopSessions)
    .set({ revokedAt: sql`now()` })
    .where(eq(schema.desktopSessions.tokenHash, sha256b64url(token)))
}

/** Admin removal / account cleanup: kill every device of a user. */
export async function revokeUserDesktopSessions(userId: string) {
  await getDb()
    .update(schema.desktopSessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(schema.desktopSessions.userId, userId),
        isNull(schema.desktopSessions.revokedAt),
      ),
    )
}
