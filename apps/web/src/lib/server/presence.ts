import { and, eq, getDb, pgErrorCode, schema, sql } from "@meet/db"

// room_presence is written here and nowhere else, fed by LiveKit webhooks.
// room_finished clears the whole room, so the table self-heals from any
// missed participant_left.

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** users.id from a member identity (u_<userId>), null for guests/agents. */
export function userIdFromIdentity(identity: string): string | null {
  if (!identity.startsWith("u_")) return null
  const id = identity.slice(2)
  return UUID_SHAPE.test(id) ? id : null
}

export async function presenceJoin(opts: {
  roomName: string
  identity: string
  displayName?: string
  kind?: string
}): Promise<void> {
  const insert = (userId: string | null) =>
    getDb()
      .insert(schema.roomPresence)
      .values({
        roomName: opts.roomName,
        identity: opts.identity,
        userId,
        displayName: opts.displayName ?? null,
        kind: opts.kind ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.roomPresence.roomName, schema.roomPresence.identity],
        set: {
          displayName: opts.displayName ?? null,
          kind: opts.kind ?? null,
          updatedAt: sql`now()`,
        },
      })
  try {
    await insert(userIdFromIdentity(opts.identity))
  } catch (err) {
    // An identity that looks like a member but has no users row (deleted
    // account, foreign token) must still show as present — never poison the
    // webhook into a retry loop over a foreign key.
    if (pgErrorCode(err) === "23503") {
      await insert(null)
    } else {
      throw err
    }
  }
}

export async function presenceLeave(
  roomName: string,
  identity: string,
): Promise<void> {
  await getDb()
    .delete(schema.roomPresence)
    .where(
      and(
        eq(schema.roomPresence.roomName, roomName),
        eq(schema.roomPresence.identity, identity),
      ),
    )
}

export async function presenceClearRoom(roomName: string): Promise<void> {
  await getDb()
    .delete(schema.roomPresence)
    .where(eq(schema.roomPresence.roomName, roomName))
}
