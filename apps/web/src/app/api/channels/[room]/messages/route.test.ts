/**
 * GET /api/channels/[room]/messages — response-shape coverage for the
 * sender-avatar field (#298). Same style as
 * apps/web/src/app/api/me/route.test.ts: the two real dependencies (a
 * Postgres connection and the resolved session) are mocked; the chained
 * query builder mock mirrors the route's actual call shape
 * (`select().from().leftJoin().where().orderBy().limit()` for messages,
 * `select().from().where()` for reactions) so a regression that changes
 * the query shape itself would be caught by a thrown error, not a silent
 * pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type MessageRow = {
  id: string
  authorUserId: string | null
  authorAgentId: string | null
  content: string
  replyToId: string | null
  attachments: unknown
  linkPreview: unknown
  pinnedAt: Date | null
  createdAt: Date
  editedAt: Date | null
  authorName: string | null
  authorAvatar: string | null
}

const { state } = vi.hoisted(() => ({
  state: {
    authMode: "auth0" as "auth0" | "none",
    user: { id: "viewer-1" } as { id: string } | null,
    channel: { id: "chan-1" } as { id: string } | null,
    canAccess: true,
    rows: [] as MessageRow[],
  },
}))

function makeMessagesChain(rows: MessageRow[]) {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  }
  return chain
}

function makeReactionsChain() {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve([]),
  }
  return chain
}

vi.mock("@meet/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@meet/db")>()
  return {
    ...actual,
    getDb: () => {
      let selectCalls = 0
      return {
        select: () => {
          selectCalls += 1
          return selectCalls === 1
            ? makeMessagesChain(state.rows)
            : makeReactionsChain()
        },
      }
    },
  }
})

vi.mock("@/lib/server/authMode", () => ({
  authMode: () => state.authMode,
}))
vi.mock("@/lib/server/session", () => ({
  getMemberUser: async () => state.user,
}))
vi.mock("@/lib/server/channels", () => ({
  getChannelByRoomName: async () => state.channel,
  canAccessChannel: async () => state.canAccess,
}))

const { GET } = await import("./route")

const ROOM = "ch-abc123"

function req(): Request {
  return new Request(`http://x/api/channels/${ROOM}/messages`)
}

function params(room = ROOM) {
  return { params: Promise.resolve({ room }) }
}

function row(overrides: Partial<MessageRow>): MessageRow {
  return {
    id: "msg-1",
    authorUserId: "user-1",
    authorAgentId: null,
    content: "hello",
    replyToId: null,
    attachments: null,
    linkPreview: null,
    pinnedAt: null,
    createdAt: new Date("2026-08-17T10:00:00Z"),
    editedAt: null,
    authorName: "Jane Doe",
    authorAvatar: null,
    ...overrides,
  }
}

describe("GET /api/channels/[room]/messages — fromAvatar", () => {
  beforeEach(() => {
    state.authMode = "auth0"
    state.user = { id: "viewer-1" }
    state.channel = { id: "chan-1" }
    state.canAccess = true
    state.rows = []
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("includes the sender's coalesced avatar as fromAvatar", async () => {
    state.rows = [
      row({ authorAvatar: "/api/avatars/user-1", authorUserId: "user-1" }),
    ]
    const res = await GET(req(), params())
    const body = (await res.json()) as { messages: { fromAvatar: unknown }[] }
    expect(body.messages[0].fromAvatar).toBe("/api/avatars/user-1")
  })

  it("returns null fromAvatar for a user with no avatar set (initials fallback)", async () => {
    state.rows = [row({ authorAvatar: null, authorUserId: "user-1" })]
    const res = await GET(req(), params())
    const body = (await res.json()) as { messages: { fromAvatar: unknown }[] }
    expect(body.messages[0].fromAvatar).toBeNull()
  })

  it("returns null fromAvatar for an agent-authored message", async () => {
    state.rows = [
      row({
        authorUserId: null,
        authorAgentId: "agent-1",
        authorAvatar: null,
      }),
    ]
    const res = await GET(req(), params())
    const body = (await res.json()) as {
      messages: { from: string; fromAvatar: unknown }[]
    }
    expect(body.messages[0].from).toBe("agent-1")
    expect(body.messages[0].fromAvatar).toBeNull()
  })
})
