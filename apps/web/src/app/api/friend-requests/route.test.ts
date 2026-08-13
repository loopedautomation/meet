import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  resetDb,
  seedUser,
  sessionState,
  sessionUserFor,
  useIsolatedTestDb,
} from "@/lib/server/friendRequestsTestSupport"

useIsolatedTestDb("meet_test_284_frroute")

vi.mock("@/lib/server/authMode", () => ({ authMode: () => "auth0" }))
vi.mock("@/lib/server/session", () => ({
  getMemberUser: async () => sessionState.user,
}))

const { POST, GET } = await import("./route")

function postReq(body: unknown, ip: string): Request {
  return new Request("http://x/api/friend-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/friend-requests", () => {
  beforeEach(async () => {
    await resetDb()
    sessionState.user = null
  })

  it("401s when signed out", async () => {
    const res = await POST(postReq({ recipientId: "x" }, "203.0.113.10"))
    expect(res.status).toBe(401)
  })

  it("sends a request to a fellow member", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    sessionState.user = sessionUserFor(a)
    const res = await POST(postReq({ recipientId: b }, "203.0.113.11"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("pending")
  })

  it("400s on a self-request", async () => {
    const a = await seedUser("alice")
    sessionState.user = sessionUserFor(a)
    const res = await POST(postReq({ recipientId: a }, "203.0.113.12"))
    expect(res.status).toBe(400)
  })

  it("400s when the recipient isn't a member of this instance", async () => {
    const a = await seedUser("alice")
    sessionState.user = sessionUserFor(a)
    const res = await POST(
      postReq(
        { recipientId: "00000000-0000-0000-0000-000000000000" },
        "203.0.113.13",
      ),
    )
    expect(res.status).toBe(400)
  })

  it("rate-limits repeated sends from the same client", async () => {
    const a = await seedUser("alice")
    sessionState.user = sessionUserFor(a)
    const ip = "203.0.113.14"
    let lastStatus = 0
    for (let i = 0; i < 21; i++) {
      const b = await seedUser(`target${i}`)
      const res = await POST(postReq({ recipientId: b }, ip))
      lastStatus = res.status
      if (i < 20) expect(res.status).toBe(200)
    }
    expect(lastStatus).toBe(429)
  })
})

describe("GET /api/friend-requests", () => {
  beforeEach(async () => {
    await resetDb()
    sessionState.user = null
  })

  it("401s when signed out", async () => {
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it("returns incoming, outgoing and connectedUserIds for the signed-in member", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const c = await seedUser("carol")
    sessionState.user = sessionUserFor(a)

    // a -> b pending (a's outgoing)
    await POST(postReq({ recipientId: b }, "203.0.113.20"))
    sessionState.user = sessionUserFor(c)
    // c -> a pending (a's incoming)
    await POST(postReq({ recipientId: a }, "203.0.113.21"))

    sessionState.user = sessionUserFor(a)
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.outgoing).toHaveLength(1)
    expect(body.outgoing[0].otherUser.id).toBe(b)
    expect(body.incoming).toHaveLength(1)
    expect(body.incoming[0].otherUser.id).toBe(c)
    expect(body.connectedUserIds).toEqual([])
  })
})
