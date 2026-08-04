import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "./schema"

// Query helpers re-exported so consumers never depend on drizzle directly —
// the ORM stays an implementation detail of this package.
export {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm"
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

/** The Postgres error code (e.g. 23505 unique_violation, 23503 foreign_key_
 * violation) from an error thrown by a query — drizzle wraps the driver
 * error, so walk the cause chain. */
export function pgErrorCode(err: unknown): string | undefined {
  let e = err
  for (let depth = 0; depth < 5 && e && typeof e === "object"; depth++) {
    if ("code" in e && typeof e.code === "string" && /^\d{5}$/.test(e.code)) {
      return e.code
    }
    e = (e as { cause?: unknown }).cause
  }
  return undefined
}

/** UUIDv7 — time-ordered, so message pagination follows creation order.
 * 48-bit ms timestamp + version/variant bits + 74 random bits. */
export function uuidv7(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const ts = Date.now()
  bytes[0] = (ts / 2 ** 40) & 0xff
  bytes[1] = (ts / 2 ** 32) & 0xff
  bytes[2] = (ts / 2 ** 24) & 0xff
  bytes[3] = (ts / 2 ** 16) & 0xff
  bytes[4] = (ts / 2 ** 8) & 0xff
  bytes[5] = ts & 0xff
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** A dedicated raw connection (LISTEN/NOTIFY, advisory locks) — callers own
 * its lifecycle; never use for regular queries, the pool handles those. */
export function createPgClient(): pg.Client {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return new pg.Client({ connectionString: url })
}

export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = null
  db = null
}
