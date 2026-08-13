import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  resetDb,
  seedUser,
  sessionState,
  sessionUserFor,
  useIsolatedTestDb,
} from "@/lib/server/friendRequestsTestSupport"

useIsolatedTestDb("meet_test_284_accept")

vi.mock("@/lib/server/authMode", () => ({ authMode: () => "auth0" }))
vi.mock("@/lib/server/session", () => ({
  getMemberUser: async () => sessionState.user,
}))

const { sendFriendRequest } = await import("@/lib/server/friendRequests")
const { POST } = await import("./route")

function req(): Request {
  return new Request("http://x/api/friend-requests/x/accept", {
    method: "POST",
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/friend-requests/[id]/accept", () => {
  beforeEach(async () => {
    await resetDb()
    sessionState.user = null
  })

  it("401s when signed out", async () => {
    const res = await POST(
      req(),
      params("00000000-0000-0000-0000-000000000000"),
    )
    expect(res.status).toBe(401)
  })

  it("opens the DM and returns its slug when the recipient accepts", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const request = await sendFriendRequest(a, b)
    sessionState.user = sessionUserFor(b)
    const res = await POST(req(), params(request.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.slug).toMatch(/^dm-/)
  })

  it("404s when the acting user isn't the recipient", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const request = await sendFriendRequest(a, b)
    sessionState.user = sessionUserFor(a)
    const res = await POST(req(), params(request.id))
    expect(res.status).toBe(404)
  })

  it("404s for a nonexistent request id", async () => {
    const a = await seedUser("alice")
    sessionState.user = sessionUserFor(a)
    const res = await POST(
      req(),
      params("00000000-0000-0000-0000-000000000000"),
    )
    expect(res.status).toBe(404)
  })
})
