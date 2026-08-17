/**
 * Auth/access gating plus the public-roster vs. private/DM-scoped-roster
 * branch for the channel member list route. Same style as
 * apps/web/src/app/api/channels/[room]/search/route.test.ts (direct
 * handler import, real Request objects) and apps/web/src/app/api/me/route.test.ts
 * (getDb mocked with a minimal fluent chain since there's no test-DB
 * harness in this repo). The chain returns different canned rows depending
 * on which table `.from()` was called with, which is how the two branches
 * (memberships-only vs. channelMembers-scoped) are distinguished without a
 * real database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

type MockUser = { id: string }
type MockChannel = { id: string; publicId: string; isPrivate: boolean }

const state: {
  authMode: "auth0" | "none"
  user: MockUser | null
  channel: MockChannel | null
  canAccess: boolean
  online: Set<string>
} = {
  authMode: "auth0",
  user: { id: "user-1" },
  channel: { id: "chan-1", publicId: "abc123", isPrivate: false },
  canAccess: true,
  online: new Set(),
}

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
vi.mock("@/lib/server/onlineRegistry", () => ({
  onlineUserIds: () => state.online,
}))

const ROW = (id: string, role: string) => ({
  id,
  name: `Name-${id}`,
  email: `${id}@x.com`,
  image: null,
  statusText: null,
  presence: null,
  role,
  joinedAt: new Date("2026-01-01"),
})
const PUBLIC_ROSTER = [ROW("u1", "owner"), ROW("u2", "member")]
const CHANNEL_SUBSET = [ROW("u1", "owner")]

vi.mock("@meet/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@meet/db")>()
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => {
          const rows =
            table === actual.schema.channelMembers
              ? CHANNEL_SUBSET
              : PUBLIC_ROSTER
          // biome-ignore lint/suspicious/noExplicitAny: minimal fluent-chain stub
          const chain: any = {
            innerJoin: () => chain,
            leftJoin: () => chain,
            where: () => chain,
            orderBy: () => Promise.resolve(rows),
          }
          return chain
        },
      }),
    }),
  }
})

const { GET } = await import("./route")

const ROOM = "ch-abc123"
function req(): Request {
  return new Request(`http://x/api/channels/${ROOM}/members`)
}
function params(room = ROOM) {
  return { params: Promise.resolve({ room }) }
}

describe("channel members route", () => {
  beforeEach(() => {
    state.authMode = "auth0"
    state.user = { id: "user-1" }
    state.channel = { id: "chan-1", publicId: "abc123", isPrivate: false }
    state.canAccess = true
    state.online = new Set()
  })

  it("404s when auth is disabled instance-wide", async () => {
    state.authMode = "none"
    const res = await GET(req(), params())
    expect(res.status).toBe(404)
  })

  it("401s when the caller isn't a member", async () => {
    state.user = null
    const res = await GET(req(), params())
    expect(res.status).toBe(401)
  })

  it("404s when the room doesn't resolve to a channel", async () => {
    state.channel = null
    const res = await GET(req(), params())
    expect(res.status).toBe(404)
  })

  it("404s when the caller can't access the channel", async () => {
    state.canAccess = false
    const res = await GET(req(), params())
    expect(res.status).toBe(404)
  })

  it("returns the full server roster for a public channel", async () => {
    const res = await GET(req(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.members.map((m: { id: string }) => m.id)).toEqual(["u1", "u2"])
  })

  it("scopes the roster to channel_members for a private channel/DM", async () => {
    state.channel = { id: "chan-1", publicId: "abc123", isPrivate: true }
    const res = await GET(req(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.members.map((m: { id: string }) => m.id)).toEqual(["u1"])
  })

  it("marks members online per onlineUserIds()", async () => {
    state.online = new Set(["u1"])
    const res = await GET(req(), params())
    const body = await res.json()
    const byId = Object.fromEntries(
      body.members.map((m: { id: string; online: boolean }) => [
        m.id,
        m.online,
      ]),
    )
    expect(byId.u1).toBe(true)
    expect(byId.u2).toBe(false)
  })
})
