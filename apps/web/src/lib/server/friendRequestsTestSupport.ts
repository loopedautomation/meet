import path from "node:path"
import { closeDb, createPgClient, getDb, schema, sql } from "@meet/db"
import { runMigrations } from "@meet/db/migrate"
import { afterAll, beforeAll } from "vitest"
import type { SessionUser } from "./session"

/**
 * Shared setup for the friend-requests test suite (friendRequests.test.ts,
 * the api/friend-requests route tests, and the dms/route.ts gate test):
 * a real local Postgres, not a mock — see .orchestrator/plans/284.md for
 * why a real DB rather than mocking drizzle's query builder.
 *
 * Each test file gets its own throwaway database (dropped and recreated in
 * beforeAll, dropped for good in afterAll) rather than sharing one — vitest
 * runs test files in parallel by default, and a single shared database's
 * truncate-in-beforeEach races against whatever another file's test is
 * doing at the same moment. None of this touches the dev stack's own
 * `meet` database, only throwaway `meet_test_284_*` ones on the same local
 * Postgres container.
 */
const ADMIN_DATABASE_URL =
  "postgresql://meet:meet-dev-only@127.0.0.1:55432/meet"

function urlFor(dbName: string): string {
  return `postgresql://meet:meet-dev-only@127.0.0.1:55432/${dbName}`
}

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../../packages/db/drizzle",
)

/** Call once at module scope in a test file: `useIsolatedTestDb("meet_test_284_foo")`.
 * Registers the beforeAll/afterAll that create, migrate and tear down this
 * file's private database, and points DATABASE_URL at it. Give every file a
 * distinct name — collisions would let two files's beforeAll/afterAll race
 * the same physical database. */
export function useIsolatedTestDb(dbName: string): void {
  beforeAll(async () => {
    process.env.DATABASE_URL = ADMIN_DATABASE_URL
    const admin = createPgClient()
    await admin.connect()
    await admin.query(`drop database if exists "${dbName}"`)
    await admin.query(`create database "${dbName}"`)
    await admin.end()

    process.env.DATABASE_URL = urlFor(dbName)
    await runMigrations(MIGRATIONS_DIR)
  })

  afterAll(async () => {
    await closeDb() // release getDb()'s pool — the DB can't drop while held open
    process.env.DATABASE_URL = ADMIN_DATABASE_URL
    const admin = createPgClient()
    await admin.connect()
    await admin.query(`drop database if exists "${dbName}"`)
    await admin.end()
  })
}

/** Wipes every table this suite touches, cascading through FKs. Call in
 * beforeEach — the database itself is per-file (see useIsolatedTestDb),
 * this just resets rows between tests within that one file. */
export async function resetDb(): Promise<void> {
  const db = getDb()
  await db.execute(
    sql`truncate table friend_requests, channel_members, channels, memberships, users restart identity cascade`,
  )
}

let seedCounter = 0

/** A minimal member: a users row plus its memberships row. */
export async function seedUser(name: string): Promise<string> {
  seedCounter += 1
  const db = getDb()
  const [user] = await db
    .insert(schema.users)
    .values({
      auth0Sub: `test|${name}-${seedCounter}`,
      email: `${name}@example.test`,
      name,
    })
    .returning()
  await db.insert(schema.memberships).values({
    userId: user.id,
    role: "member",
  })
  return user.id
}

/**
 * Mutable "who's signed in" cell for route tests — routes call
 * getMemberUser(), which the test file mocks (`vi.mock("@/lib/server/session"...)`)
 * to read this. Set it per-test, `sessionState.user = null` for the
 * signed-out case.
 */
export const sessionState: { user: SessionUser | null } = { user: null }

/** A minimal SessionUser for a seeded member — everything the routes under
 * test actually read is `id`; the rest are plausible filler. */
export function sessionUserFor(userId: string): SessionUser {
  return {
    id: userId,
    auth0Sub: `test|${userId}`,
    email: null,
    name: null,
    image: null,
    presence: "active",
    role: "member",
  }
}
