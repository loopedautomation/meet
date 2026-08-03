export type AuthMode = "none" | "auth0"

// Deliberately dependency-free (no @meet/db): this module is imported from
// the proxy, and must not drag pg/drizzle into that bundle.
function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

function auth0Configured(): boolean {
  return Boolean(
    process.env.AUTH0_DOMAIN &&
      process.env.AUTH0_CLIENT_ID &&
      process.env.AUTH0_CLIENT_SECRET &&
      process.env.AUTH0_SECRET,
  )
}

/**
 * MEET_AUTH_MODE=none reproduces the pre-accounts product byte-for-byte.
 * Unset resolves from what's configured, so existing deployments that
 * upgrade without adding Auth0 env keep working unchanged.
 */
export function authMode(): AuthMode {
  const explicit = process.env.MEET_AUTH_MODE
  if (explicit === "none") return "none"
  if (explicit === "auth0") {
    if (!auth0Configured() || !hasDatabase()) {
      throw new Error(
        "MEET_AUTH_MODE=auth0 requires AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET and DATABASE_URL",
      )
    }
    return "auth0"
  }
  return auth0Configured() && hasDatabase() ? "auth0" : "none"
}
