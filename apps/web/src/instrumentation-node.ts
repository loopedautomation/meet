import fs from "node:fs"
import path from "node:path"

// Known placeholder secrets must never survive into production — same
// policy as the bridge's WEAK_TOKEN check. AUTH0_SECRET guards session
// cookies, so a weak one refuses to start in production outright. The
// dev-only postgres password only warns: the stack's postgres is never
// published to the host (compose-network only), and NODE_ENV=production is
// baked into locally-built images too, so refusing would break `pnpm
// dev:up` — loud and repeated beats fatal here.
function guardWeakSecrets(): void {
  const weak = /change_?me|devsecret|devkey|placeholder|example|meet-dev-only/i
  if (process.env.DATABASE_URL && weak.test(process.env.DATABASE_URL)) {
    console.warn(
      "WARNING: DATABASE_URL uses the dev-only postgres password — fine for local dev; set POSTGRES_PASSWORD for production.",
    )
  }
  const auth0Secret = process.env.AUTH0_SECRET
  if (auth0Secret && (weak.test(auth0Secret) || auth0Secret.length < 32)) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "AUTH0_SECRET is a placeholder or too short (<32 chars); refusing to start in production. Generate one with: openssl rand -hex 32",
      )
      process.exit(1)
    }
    console.warn(
      "WARNING: AUTH0_SECRET looks like a placeholder or is too short — fine for local dev only.",
    )
  }
}

// Node-runtime half of instrumentation.ts — split out so the edge build
// (which exists because of proxy.ts) never sees node:fs/node:path.
export async function registerNode(): Promise<void> {
  guardWeakSecrets()
  if (!process.env.DATABASE_URL) {
    // Databaseless deployments (MEET_AUTH_MODE=none compat) are supported —
    // the app behaves exactly like the pre-accounts product.
    console.warn(
      "db: DATABASE_URL not set — accounts and channels are disabled",
    )
    return
  }
  const candidates = [
    process.env.DB_MIGRATIONS_DIR,
    // Standalone image: drizzle folder copied next to the server (cwd /app).
    path.join(process.cwd(), "packages/db/drizzle"),
    // Dev: next dev runs with cwd apps/web inside the monorepo.
    path.join(process.cwd(), "../../packages/db/drizzle"),
  ].filter((p): p is string => Boolean(p))
  const migrationsFolder = candidates.find((p) => fs.existsSync(p))
  if (!migrationsFolder) {
    throw new Error(
      `db: migrations folder not found (looked in: ${candidates.join(", ")})`,
    )
  }
  const { runMigrations } = await import("@meet/db/migrate")
  await runMigrations(migrationsFolder)
  console.log("db: migrations up to date")
  startRetentionSweeper()
}

// Data lifecycle: each server can set its own retention window; expired
// messages in that server's channels are hard-deleted (reactions cascade).
// Runs at boot and daily — coarse on purpose; retention is a policy, not a
// stopwatch.
function startRetentionSweeper(): void {
  const sweep = async () => {
    try {
      const { getDb, schema, lt, inArray, eq, and } = await import("@meet/db")
      const db = getDb()
      const servers = await db
        .select({
          id: schema.servers.id,
          retentionDays: schema.servers.retentionDays,
        })
        .from(schema.servers)
      for (const server of servers) {
        const days = server.retentionDays
        if (!days) continue
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        const channels = await db
          .select({ id: schema.channels.id })
          .from(schema.channels)
          .where(eq(schema.channels.serverId, server.id))
        const channelIds = channels.map((c) => c.id)
        if (channelIds.length === 0) continue
        await db
          .delete(schema.messages)
          .where(
            and(
              lt(schema.messages.createdAt, cutoff),
              inArray(schema.messages.channelId, channelIds),
            ),
          )
      }
    } catch (err) {
      console.error("retention sweep failed", err)
    }
  }
  void sweep()
  setInterval(() => void sweep(), 24 * 60 * 60 * 1000).unref?.()
}
