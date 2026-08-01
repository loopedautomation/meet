import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "./schema"

export * as schema from "./schema"

export type Db = NodePgDatabase<typeof schema>

let pool: pg.Pool | null = null
let db: Db | null = null

/** Whether a database is configured for this deployment. When false the app
 * must behave exactly like the pre-accounts product (MEET_AUTH_MODE=none). */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

/** Lazy singleton — safe to import from code paths that may run without a
 * database configured, as long as they check hasDatabase() first. */
export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set — database features are unavailable",
      )
    }
    pool = new pg.Pool({ connectionString: url, max: 10 })
    db = drizzle(pool, { schema })
  }
  return db
}

export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = null
  db = null
}
