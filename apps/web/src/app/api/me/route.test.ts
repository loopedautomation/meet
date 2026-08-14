import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Seam under test: the PATCH /api/me HTTP handler (Request in, Response +
// the DB write it issues out) — same style as
// apps/web/src/app/api/rooms/[slug]/claim-host/route.test.ts (direct
// handler import, real Request objects). The two real dependencies this
// route has — a Postgres connection and the resolved session — are system
// boundaries this repo has no test-DB infra for, so they're mocked; nothing
// internal to the route itself is mocked.
const { captured, sessionUser, mode } = vi.hoisted(() => ({
  captured: { set: undefined as Record<string, unknown> | undefined },
  // biome-ignore lint/suspicious/noExplicitAny: minimal session stub, only `id` is read by the route
  sessionUser: { current: null as any },
  mode: { current: "auth0" as "auth0" | "none" },
}))

vi.mock("@meet/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@meet/db")>()
  return {
    ...actual,
    getDb: () => ({
      update: () => ({
        set: (value: Record<string, unknown>) => {
          captured.set = value
          return { where: async () => {} }
        },
      }),
    }),
  }
})

vi.mock("@/lib/server/session", () => ({
  getSessionUser: async () => sessionUser.current,
}))

vi.mock("@/lib/server/authMode", () => ({
  authMode: () => mode.current,
}))

const { PATCH } = await import("./route")

function req(body: unknown): Request {
  return new Request("http://x/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/me — displayName override", () => {
  beforeEach(() => {
    captured.set = undefined
    sessionUser.current = { id: "u1" }
    mode.current = "auth0"
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("sets the displayName override", async () => {
    const res = await PATCH(req({ displayName: "Jane Doe" }))
    expect(res.status).toBe(200)
    expect(captured.set).toEqual({ displayName: "Jane Doe" })
  })

  it("clears the override when displayName is null", async () => {
    const res = await PATCH(req({ displayName: null }))
    expect(res.status).toBe(200)
    expect(captured.set).toEqual({ displayName: null })
  })

  it("trims whitespace before saving", async () => {
    const res = await PATCH(req({ displayName: "  Jane Doe  " }))
    expect(res.status).toBe(200)
    expect(captured.set).toEqual({ displayName: "Jane Doe" })
  })

  it("rejects an empty-string override (blank isn't a valid name — use null to clear)", async () => {
    const res = await PATCH(req({ displayName: "" }))
    expect(res.status).toBe(400)
    expect(captured.set).toBeUndefined()
  })

  it("rejects a name over 80 characters", async () => {
    const res = await PATCH(req({ displayName: "x".repeat(81) }))
    expect(res.status).toBe(400)
    expect(captured.set).toBeUndefined()
  })

  it("leaves statusText/presence untouched when only displayName is sent", async () => {
    await PATCH(req({ displayName: "Jane" }))
    expect(captured.set).not.toHaveProperty("statusText")
    expect(captured.set).not.toHaveProperty("presence")
  })

  it("rejects when signed out", async () => {
    sessionUser.current = null
    const res = await PATCH(req({ displayName: "Jane" }))
    expect(res.status).toBe(401)
    expect(captured.set).toBeUndefined()
  })

  it("404s when the deployment runs without accounts", async () => {
    mode.current = "none"
    const res = await PATCH(req({ displayName: "Jane" }))
    expect(res.status).toBe(404)
    expect(captured.set).toBeUndefined()
  })
})
