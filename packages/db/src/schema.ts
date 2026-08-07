import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

// Schema v2 — an instance hosts multiple servers (Discord-style teams).
// Membership, channels, invites and agents are all server-scoped; guests
// never become rows here, they stay room-scoped LiveKit identities exactly
// as before accounts existed.

// A server is a self-contained team/workspace: its own channels, members
// and agents. The first-ever server on a fresh instance is seeded from the
// old singleton instance_settings row (see migration 0007) so existing
// deployments keep working unchanged after the multi-server upgrade.
export const servers = pgTable(
  "servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Short stable handle used in /s/<slug> URLs.
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    iconUrl: text("icon_url"),
    registration: text("registration").notNull().default("invite"),
    // Message retention in days; null keeps everything forever.
    retentionDays: integer("retention_days"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 'open' (public servers) is accepted by the schema but not offered by
    // the app until Phase 3 — private/invite-only is the only launch mode.
    check(
      "servers_registration_check",
      sql`${t.registration} in ('invite', 'open')`,
    ),
  ],
)

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Auth0 subject ("auth0|abc", "google-oauth2|123", …) — the identity key.
  auth0Sub: text("auth0_sub").notNull().unique(),
  email: text("email"),
  name: text("name"),
  image: text("image"),
  // Custom status ("in deep work", "back at 3") shown next to the name.
  statusText: text("status_text"),
  // Presence indicator the member picks: active | away | dnd. The effective
  // dot combines this with the live online registry (offline beats all).
  presence: text("presence").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

// Per-server membership — a user has one row per server they belong to,
// with a role scoped to that server (owner/admin on one server may be a
// plain member, or absent entirely, on another).
export const memberships = pgTable(
  "memberships",
  {
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.serverId, t.userId] }),
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
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
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

// Desktop sign-in handoff: the shell starts a request with a PKCE-style
// challenge, the browser session approves it (minting a one-time code), and
// the shell exchanges code+verifier for a desktop session. Rows are inert
// after 10 minutes or first use.
export const desktopAuthRequests = pgTable("desktop_auth_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  // base64url(sha256(verifier)) — the verifier never leaves the shell.
  challenge: text("challenge").notNull(),
  // sha256 of the one-time code; null until a signed-in member approves.
  codeHash: text("code_hash").unique(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

// Desktop shell sessions — the server-side store behind the
// meet_desktop_session cookie (the web session stays the Auth0 SDK cookie;
// this parallel store exists so devices can be revoked individually).
export const desktopSessions = pgTable("desktop_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // sha256 of the cookie value; the plaintext token is never stored.
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceName: text("device_name"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Sliding — bumped on activity; stale devices age out.
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    // Short stable id that becomes the LiveKit room name ("ch-<publicId>").
    publicId: text("public_id").notNull().unique(),
    // Human handle shown in the sidebar and used in /c/<slug> URLs. Globally
    // unique (not per-server) — URLs stay /c/<slug> without a server
    // segment, so two servers can't both claim the same slug; createChannel
    // disambiguates default channel names on collision.
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("voice"),
    topic: text("topic"),
    isPrivate: boolean("is_private").notNull().default(false),
    // DMs are private text channels between a fixed set of members, with a
    // deterministic slug (dm-<hash of member ids>) so the same people always
    // land in the same conversation.
    isDm: boolean("is_dm").notNull().default(false),
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

// Agents invited to the server: DMable, addable to group chats, listed in
// the directory. agent_id references the bridge's registry. Meeting rooms
// keep offering the full registry roster regardless — this table gates the
// text surfaces.
export const serverAgents = pgTable(
  "server_agents",
  {
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    // Snapshot of the registry name at invite time — labels (DM lists) read
    // it without a bridge roundtrip.
    name: text("name"),
    addedBy: uuid("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.agentId] })],
)

// Agents assigned to a channel: auto-dispatched when the first human joins,
// parked when the room empties (end-when-empty tears the room down and the
// agent with it). agent_id references the bridge's registry, not a table.
export const channelAgents = pgTable(
  "channel_agents",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    addedBy: uuid("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.agentId] })],
)

// Durable external agents: looped-af agents that registered themselves (via
// a registration token) or were pasted by an admin. They behave like registry
// agents — usable in server_agents/channel_agents/DMs — but their TTY spec
// lives here instead of agent-registry.yaml. The bearer token is encrypted at
// rest (AES-256-GCM under AGENT_TOKEN_ENC_KEY); plaintext never lands in the
// database or leaves the server.
export const externalAgents = pgTable("external_agents", {
  // "ext-<8hex>" — stable across re-registrations, so channel/server
  // assignments survive an agent redeploying under a new URL.
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  // Normalized wss TTY URL (see the bridge's normalizeAgentUrl).
  url: text("url").notNull(),
  // "v1:<iv b64>:<tag b64>:<data b64>" — AES-256-GCM.
  tokenCiphertext: text("token_ciphertext").notNull(),
  voice: text("voice"),
  // The registration token that owns this agent; re-registering with the
  // same token updates this row in place. Null for admin-pasted agents.
  registrationTokenId: uuid("registration_token_id").unique(),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
})

// Registration tokens ("lreg_<32hex>") minted by admins; an agent presents
// one to POST /api/agents/register. Only the sha256 of the token is stored.
export const agentRegistrationTokens = pgTable("agent_registration_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label"),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
})

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
    // [{ key, name, type, size }] — objects live in S3-compatible storage
    // (R2 for the hosted offering); the key is served through the
    // membership-checked attachments route, never directly.
    attachments: jsonb("attachments"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("messages_channel_created_idx").on(t.channelId, t.createdAt.desc()),
    // Search v1: instance-wide full-text over message content.
    index("messages_content_fts_idx").using(
      "gin",
      sql`to_tsvector('english', ${t.content})`,
    ),
    check(
      "messages_author_kind_check",
      sql`${t.authorKind} in ('user', 'agent', 'system')`,
    ),
  ],
)

export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
)

// Unread markers: where each member last caught up in each channel.
export const channelReads = pgTable(
  "channel_reads",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] })],
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

// Legacy — pre-multi-server single-row instance config. No longer read or
// written by the app (see servers.registration/retentionDays); kept only
// so migration 0007's backfill has something to seed the first server
// from. Safe to drop in a later migration once every deployment is past it.
export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: integer("id").primaryKey().default(1),
    name: text("name"),
    iconUrl: text("icon_url"),
    registration: text("registration").notNull().default("invite"),
    // Message retention in days; null keeps everything forever.
    retentionDays: integer("retention_days"),
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
