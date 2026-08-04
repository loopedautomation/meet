import { Auth0Client } from "@auth0/nextjs-auth0/server"
import { authMode } from "./authMode"

let client: Auth0Client | null = null

/** The Auth0 SDK client — only meaningful when authMode() is "auth0".
 * Reads AUTH0_DOMAIN / AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET / AUTH0_SECRET
 * and APP_BASE_URL from the environment. */
export function auth0(): Auth0Client {
  if (authMode() !== "auth0") {
    throw new Error("auth0() called while MEET_AUTH_MODE is none")
  }
  if (!client) {
    client = new Auth0Client({
      // The SDK also reads these from env directly; passing them explicitly
      // keeps the dependency visible.
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      secret: process.env.AUTH0_SECRET,
      appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    })
  }
  return client
}
