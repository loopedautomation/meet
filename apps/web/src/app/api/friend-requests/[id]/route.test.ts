import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  resetDb,
  seedUser,
  sessionState,
  sessionUserFor,
  useIsolatedTestDb,
} from "@/lib/server/friendRequestsTestSupport"

useIsolatedTestDb("meet_test_284_cancel")

vi.mock("@/lib/server/authMode", () => ({ authMode: () => "auth0" }))
vi.mock("@/lib/server/session", () => ({
  getMemberUser: async () => sessionState.user,
}))

const { sendFriendRequest } = await import("@/lib/server/friendRequests")
const { DELETE } = await import("./route")

function req(): Request {
  return new Request("http://x/api/friend-requests/x", { method: "DELETE" })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("DELETE /api/friend-requests/[id]", () => {
  beforeEach(async () => {
    await resetDb()
    sessionState.user = null
  })

  it("401s when signed out", async () => {
    const res = await DELETE(
      req(),
      params("00000000-0000-0000-0000-000000000000"),
    )
    expect(res.status).toBe(401)
  })

  it("lets the sender cancel their own pending request", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const request = await sendFriendRequest(a, b)
    sessionState.user = sessionUserFor(a)
    const res = await DELETE(req(), params(request.id))
    expect(res.status).toBe(200)
  })

  it("404s when the acting user isn't the requester", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const request = await sendFriendRequest(a, b)
    sessionState.user = sessionUserFor(b)
    const res = await DELETE(req(), params(request.id))
    expect(res.status).toBe(404)
  })
})
