import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

// Arbitrary but stable: identifies "meet schema migration" in pg_locks.
const MIGRATION_LOCK_ID = 7_213_346_001

/**
 * Run all pending SQL migrations, serialized under a Postgres advisory lock
 * so concurrent server starts (or a future second replica) can't race. Throws
 * on failure — callers should let that crash the boot: a half-migrated
 * database must be visible, not served around.
 */
export async function runMigrations(migrationsFolder: string): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  // Single dedicated connection: the advisory lock is session-scoped. Retry
  // the connect briefly — at dev-stack boot the server can come up a few
  // seconds before postgres finishes initializing.
  const client = await connectWithRetry(url, 15, 1000)
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID])
    const db = drizzle(client)
    await migrate(db, { migrationsFolder })
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
  } finally {
    await client.end()
  }
}

async function connectWithRetry(
  url: string,
  attempts: number,
  delayMs: number,
): Promise<pg.Client> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    const client = new pg.Client({ connectionString: url })
    try {
      await client.connect()
      return client
    } catch (err) {
      lastError = err
      await client.end().catch(() => {})
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastError
}
