import { eq, getDb, schema } from "@meet/db"
import { customAlphabet } from "nanoid"
import { createChannel } from "./channels"

const slugSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 5)

export type Server = typeof schema.servers.$inferSelect

/** Server handles are URL-safe: lowercase, digits, hyphens. */
export function isValidServerSlug(slug: string): boolean {
  return (
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) &&
    slug.length >= 2 &&
    slug.length <= 48
  )
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return base || "server"
}

/**
 * Create a server, make the creator its owner, and seed the two default
 * channels (#general text, General voice) — the Discord-style "land inside
 * your new server with somewhere to talk" moment. Channel slugs are
 * globally unique, so a collision (another server already has #general)
 * gets a short random suffix rather than failing the whole creation.
 */
export async function createServer(opts: {
  name: string
  iconUrl?: string
  createdBy: string
}): Promise<{ server: Server; defaultChannelSlug: string }> {
  const db = getDb()

  let slug = slugify(opts.name)
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db.query.servers.findFirst({
      where: eq(schema.servers.slug, slug),
    })
    if (!existing) break
    slug = `${slugify(opts.name)}-${slugSuffix()}`
  }

  const [server] = await db
    .insert(schema.servers)
    .values({
      slug,
      name: opts.name.trim(),
      iconUrl: opts.iconUrl ?? null,
      createdBy: opts.createdBy,
    })
    .returning()

  await db
    .insert(schema.memberships)
    .values({ serverId: server.id, userId: opts.createdBy, role: "owner" })

  const uniqueChannelSlug = async (base: string) => {
    let candidate = base
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await db.query.channels.findFirst({
        where: eq(schema.channels.slug, candidate),
      })
      if (!existing) return candidate
      candidate = `${base}-${slugSuffix()}`
    }
    return candidate
  }

  // Default channels — best-effort: the server and owner membership above
  // are the part that must not fail; if seeding defaults hiccups, an admin
  // can still create channels by hand, same as any other server.
  const textChannel = await createChannel({
    serverId: server.id,
    slug: await uniqueChannelSlug("general"),
    name: "general",
    kind: "text",
    createdBy: opts.createdBy,
  })
  await createChannel({
    serverId: server.id,
    slug: await uniqueChannelSlug("general-voice"),
    name: "General",
    kind: "voice",
    createdBy: opts.createdBy,
  })

  return { server, defaultChannelSlug: textChannel.slug }
}

export async function getServerBySlug(slug: string): Promise<Server | null> {
  const server = await getDb().query.servers.findFirst({
    where: eq(schema.servers.slug, slug),
  })
  return server ?? null
}

export async function getServerById(id: string): Promise<Server | null> {
  const server = await getDb().query.servers.findFirst({
    where: eq(schema.servers.id, id),
  })
  return server ?? null
}

export type ServerWithRole = Server & { role: "owner" | "admin" | "member" }

/** Servers this user belongs to, each carrying their role on that server —
 * the sidebar switcher and the create-server empty-state read this. */
export async function listServersForUser(
  userId: string,
): Promise<ServerWithRole[]> {
  const rows = await getDb()
    .select({ server: schema.servers, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(
      schema.servers,
      eq(schema.servers.id, schema.memberships.serverId),
    )
    .where(eq(schema.memberships.userId, userId))
    .orderBy(schema.servers.createdAt)
  return rows.map((r) => ({
    ...r.server,
    role: r.role as ServerWithRole["role"],
  }))
}

export async function getMembership(serverId: string, userId: string) {
  return await getDb().query.memberships.findFirst({
    where: (m, { and, eq }) =>
      and(eq(m.serverId, serverId), eq(m.userId, userId)),
  })
}

export async function canAccessServer(
  serverId: string,
  userId: string,
): Promise<boolean> {
  const membership = await getMembership(serverId, userId)
  return Boolean(membership)
}
