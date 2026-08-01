import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

// Schema v1 — the instance IS the team. Membership is instance-level (no
// teams table); guests never become rows here, they stay room-scoped LiveKit
// identities exactly as before accounts existed.

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Auth0 subject ("auth0|abc", "google-oauth2|123", …) — the identity key.
  auth0Sub: text("auth0_sub").notNull().unique(),
  email: text("email"),
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "memberships_role_check",
      sql`${t.role} in ('owner', 'admin', 'member')`,
    ),
  ],
)

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    role: text("role").notNull().default("member"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    useCount: integer("use_count").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("invites_role_check", sql`${t.role} in ('admin', 'member')`)],
)

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Short stable id that becomes the LiveKit room name ("ch-<publicId>").
    publicId: text("public_id").notNull().unique(),
    // Human handle shown in the sidebar and used in /c/<slug> URLs.
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("voice"),
    topic: text("topic"),
    isPrivate: boolean("is_private").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [check("channels_kind_check", sql`${t.kind} in ('voice', 'text')`)],
)

// Only consulted for private channels; public channels are visible and
// joinable by every member.
export const channelMembers = pgTable(
  "channel_members",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] })],
)

// Designed now, written from Phase 2 (text channels) and the Phase 1 text
// sidecar. Ids are supplied by the app as UUIDv7 so pagination follows time.
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authorKind: text("author_kind").notNull().default("user"),
    authorAgentId: text("author_agent_id"),
    content: text("content").notNull(),
    replyToId: uuid("reply_to_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("messages_channel_created_idx").on(t.channelId, t.createdAt.desc()),
    check(
      "messages_author_kind_check",
      sql`${t.authorKind} in ('user', 'agent', 'system')`,
    ),
  ],
)

// Written solely by the LiveKit webhook handler; the sidebar reads it.
// room_finished clears a room's rows, so the table self-heals from missed
// participant_left events.
export const roomPresence = pgTable(
  "room_presence",
  {
    roomName: text("room_name").notNull(),
    identity: text("identity").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    kind: text("kind"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roomName, t.identity] })],
)

// Single-row table (id always 1) for per-instance settings.
export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: integer("id").primaryKey().default(1),
    name: text("name"),
    iconUrl: text("icon_url"),
    registration: text("registration").notNull().default("invite"),
  },
  (t) => [
    check("instance_settings_singleton", sql`${t.id} = 1`),
    // 'open' (public servers) is accepted by the schema but not offered by
    // the app until Phase 3 — private/invite-only is the only launch mode.
    check(
      "instance_settings_registration_check",
      sql`${t.registration} in ('invite', 'open')`,
    ),
  ],
)
