import fs from "node:fs"
import path from "node:path"

// Known placeholder secrets must never survive into production — same
// policy as the bridge's WEAK_TOKEN check: refuse in production, warn
// everywhere else.
function guardWeakSecrets(): void {
  const weak = /change_?me|devsecret|devkey|placeholder|example|meet-dev-only/i
  const problems: string[] = []
  if (process.env.DATABASE_URL && weak.test(process.env.DATABASE_URL)) {
    problems.push(
      "DATABASE_URL uses the dev-only postgres password (set POSTGRES_PASSWORD)",
    )
  }
  const auth0Secret = process.env.AUTH0_SECRET
  if (auth0Secret && (weak.test(auth0Secret) || auth0Secret.length < 32)) {
    problems.push(
      "AUTH0_SECRET is a placeholder or too short — openssl rand -hex 32",
    )
  }
  if (problems.length === 0) return
  if (process.env.NODE_ENV === "production") {
    for (const p of problems)
      console.error(`refusing to start in production: ${p}`)
    process.exit(1)
  }
  for (const p of problems) console.warn(`WARNING (dev only): ${p}`)
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
}
