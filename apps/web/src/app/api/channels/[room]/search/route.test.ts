/**
 * Auth gating, query-length bounds and rate-limit behavior for the
 * channel-scoped search route. Deliberately does not assert anything about
 * the FTS query itself (no live-DB harness in this repo) — every case here
 * is designed to short-circuit before the route ever calls getDb(), so a
 * regression that accidentally reaches the database on these inputs would
 * throw (no DATABASE_URL in the test env) rather than silently pass.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

type MockUser = { id: string; role: "owner" | "admin" | "member" | null }
type MockChannel = { id: string; publicId: string }

const state: {
  authMode: "auth0" | "none"
  user: MockUser | null
  channel: MockChannel | null
  canAccess: boolean
} = {
  authMode: "auth0",
  user: { id: "user-1", role: "member" },
  channel: { id: "chan-1", publicId: "abc123" },
  canAccess: true,
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

const { GET } = await import("./route")

const ROOM = "ch-abc123"

function req(qs: string, ip: string): Request {
  return new Request(`http://x/api/channels/${ROOM}/search?${qs}`, {
    headers: { "x-forwarded-for": ip },
  })
}

function params(room = ROOM) {
  return { params: Promise.resolve({ room }) }
}

describe("channel search route", () => {
  beforeEach(() => {
    state.authMode = "auth0"
    state.user = { id: "user-1", role: "member" }
    state.channel = { id: "chan-1", publicId: "abc123" }
    state.canAccess = true
  })

  it("404s when auth is disabled instance-wide", async () => {
    state.authMode = "none"
    const res = await GET(req("q=hello", "203.0.113.10"), params())
    expect(res.status).toBe(404)
  })

  it("401s when the caller isn't a member", async () => {
    state.user = null
    const res = await GET(req("q=hello", "203.0.113.11"), params())
    expect(res.status).toBe(401)
  })

  it("404s when the room doesn't resolve to a channel", async () => {
    state.channel = null
    const res = await GET(req("q=hello", "203.0.113.12"), params())
    expect(res.status).toBe(404)
  })

  it("404s when the caller can't access the channel", async () => {
    state.canAccess = false
    const res = await GET(req("q=hello", "203.0.113.13"), params())
    expect(res.status).toBe(404)
  })

  it("returns no results for a too-short query without touching the db", async () => {
    const res = await GET(req("q=a", "203.0.113.14"), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [], hasMore: false })
  })

  it("returns no results for an over-long query without touching the db", async () => {
    const res = await GET(req(`q=${"x".repeat(201)}`, "203.0.113.15"), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [], hasMore: false })
  })

  it("rate-limits after 30 requests/min from the same client", async () => {
    const ip = "203.0.113.16"
    // q is intentionally too short so every one of these 30 calls resolves
    // before the db query, same as the bounds tests above.
    for (let i = 0; i < 30; i++) {
      const res = await GET(req("q=a", ip), params())
      expect(res.status).toBe(200)
    }
    const res = await GET(req("q=a", ip), params())
    expect(res.status).toBe(429)
  })
})
