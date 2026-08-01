import fs from "node:fs"
import path from "node:path"

// Node-runtime half of instrumentation.ts — split out so the edge build
// (which exists because of proxy.ts) never sees node:fs/node:path.
export async function registerNode(): Promise<void> {
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
}
