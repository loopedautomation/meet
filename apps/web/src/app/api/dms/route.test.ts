import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  resetDb,
  seedUser,
  sessionState,
  sessionUserFor,
  useIsolatedTestDb,
} from "@/lib/server/friendRequestsTestSupport"

useIsolatedTestDb("meet_test_284_dmsgate")

vi.mock("@/lib/server/authMode", () => ({ authMode: () => "auth0" }))
vi.mock("@/lib/server/session", () => ({
  getMemberUser: async () => sessionState.user,
}))

const { sendFriendRequest, acceptFriendRequest } = await import(
  "@/lib/server/friendRequests"
)
const { findOrCreateDm } = await import("@/lib/server/channels")
const { POST } = await import("./route")

function req(body: unknown): Request {
  return new Request("http://x/api/dms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/dms — friend-request gate", () => {
  beforeEach(async () => {
    await resetDb()
    sessionState.user = null
  })

  it("blocks a 1:1 DM between two people with no connection", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    sessionState.user = sessionUserFor(a)
    const res = await POST(req({ userIds: [b] }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("request_required")
  })

  it("allows a 1:1 DM once the request is accepted", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const request = await sendFriendRequest(a, b)
    await acceptFriendRequest(request.id, b)
    sessionState.user = sessionUserFor(a)
    const res = await POST(req({ userIds: [b] }))
    expect(res.status).toBe(200)
  })

  it("grandfathers a pre-existing DM channel with no friend request at all", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    await findOrCreateDm([a, b])
    sessionState.user = sessionUserFor(a)
    const res = await POST(req({ userIds: [b] }))
    expect(res.status).toBe(200)
  })

  it("does not gate a group DM even with no connections at all", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const c = await seedUser("carol")
    sessionState.user = sessionUserFor(a)
    const res = await POST(req({ userIds: [b, c] }))
    expect(res.status).toBe(200)
  })
})
