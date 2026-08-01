// Runs once at server boot (dev and standalone alike), before traffic is
// served. Migrations live here rather than in a separate CMD step so the
// migrator and its dependencies ride Next's file tracing into the standalone
// image, and a bad migration fails the boot loudly instead of being served
// around.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return
  if (!process.env.DATABASE_URL) {
    // Databaseless deployments (MEET_AUTH_MODE=none compat) are supported —
    // the app behaves exactly like the pre-accounts product.
    console.warn(
      "db: DATABASE_URL not set — accounts and channels are disabled",
    )
    return
  }
  const path = await import("node:path")
  const fs = await import("node:fs")
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
