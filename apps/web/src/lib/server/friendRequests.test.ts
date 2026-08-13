import { beforeEach, describe, expect, it } from "vitest"
import {
  resetDb,
  seedUser,
  useIsolatedTestDb,
} from "./friendRequestsTestSupport"

useIsolatedTestDb("meet_test_284_module")

const {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  listIncoming,
  listOutgoing,
  connectedUserIds,
} = await import("./friendRequests")
const { findOrCreateDm } = await import("./channels")

describe("sendFriendRequest", () => {
  beforeEach(async () => {
    await resetDb()
  })

  it("rejects a self-request", async () => {
    const a = await seedUser("alice")
    await expect(sendFriendRequest(a, a)).rejects.toThrow(/yourself/i)
  })

  it("creates a pending request for a fresh pair", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const req = await sendFriendRequest(a, b)
    expect(req.requesterId).toBe(a)
    expect(req.recipientId).toBe(b)
    expect(req.status).toBe("pending")
  })

  it("returns the existing pending row instead of duplicating on re-send", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const first = await sendFriendRequest(a, b)
    const second = await sendFriendRequest(a, b)
    expect(second.id).toBe(first.id)
  })

  it("does not auto-accept — sending back while the other side's request is pending just returns their row", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const aToB = await sendFriendRequest(a, b)
    const bToA = await sendFriendRequest(b, a)
    // No new row was created in the reverse direction; b's attempt just
    // surfaces a's still-pending request. Still pending, not accepted —
    // accepting is always its own explicit action.
    expect(bToA.id).toBe(aToB.id)
    expect(bToA.status).toBe("pending")
  })
})

describe("acceptFriendRequest", () => {
  beforeEach(async () => {
    await resetDb()
  })

  it("opens the DM when the recipient accepts", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const req = await sendFriendRequest(a, b)
    const channel = await acceptFriendRequest(req.id, b)
    expect(channel).not.toBeNull()
    expect(channel?.isDm).toBe(true)
  })

  it("refuses when the acting user isn't the recipient", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const req = await sendFriendRequest(a, b)
    // the requester trying to accept their own outgoing request
    const channel = await acceptFriendRequest(req.id, a)
    expect(channel).toBeNull()
  })

  it("refuses a request that's already been responded to", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const req = await sendFriendRequest(a, b)
    await acceptFriendRequest(req.id, b)
    const second = await acceptFriendRequest(req.id, b)
    expect(second).toBeNull()
  })
})

describe("declineFriendRequest", () => {
  beforeEach(async () => {
    await resetDb()
  })

  it("discards the request — no block, sender can re-request", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const req = await sendFriendRequest(a, b)
    const declined = await declineFriendRequest(req.id, b)
    expect(declined?.status).toBe("declined")

    // discard-only: a fresh send from the same sender is allowed again,
    // and lands as a brand new pending row (not the old declined one).
    const resend = await sendFriendRequest(a, b)
    expect(resend.status).toBe("pending")
    expect(resend.id).not.toBe(req.id)
  })

  it("refuses when the acting user isn't the recipient", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const req = await sendFriendRequest(a, b)
    const result = await declineFriendRequest(req.id, a)
    expect(result).toBeNull()
  })
})

describe("cancelFriendRequest", () => {
  beforeEach(async () => {
    await resetDb()
  })

  it("lets the sender cancel their own pending request", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const req = await sendFriendRequest(a, b)
    const canceled = await cancelFriendRequest(req.id, a)
    expect(canceled?.status).toBe("canceled")

    // the recipient can no longer accept a canceled request
    const accept = await acceptFriendRequest(req.id, b)
    expect(accept).toBeNull()
  })

  it("refuses when the acting user isn't the requester", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const req = await sendFriendRequest(a, b)
    const result = await cancelFriendRequest(req.id, b)
    expect(result).toBeNull()
  })
})

describe("listIncoming / listOutgoing", () => {
  beforeEach(async () => {
    await resetDb()
  })

  it("shows a's pending send in b's incoming and a's outgoing, with the other side's profile", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    await sendFriendRequest(a, b)

    const incoming = await listIncoming(b)
    expect(incoming).toHaveLength(1)
    expect(incoming[0].otherUser.id).toBe(a)
    expect(incoming[0].otherUser.name).toBe("alice")
    expect(incoming[0].status).toBe("pending")

    const outgoing = await listOutgoing(a)
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0].otherUser.id).toBe(b)

    // not each other's — a has no incoming, b has no outgoing
    expect(await listIncoming(a)).toHaveLength(0)
    expect(await listOutgoing(b)).toHaveLength(0)
  })

  it("drops a request from both lists once it's been resolved", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const req = await sendFriendRequest(a, b)
    await acceptFriendRequest(req.id, b)

    expect(await listIncoming(b)).toHaveLength(0)
    expect(await listOutgoing(a)).toHaveLength(0)
  })
})

describe("connectedUserIds", () => {
  beforeEach(async () => {
    await resetDb()
  })

  it("is empty for someone with no requests or DMs", async () => {
    const a = await seedUser("alice")
    await seedUser("bob")
    expect((await connectedUserIds(a)).size).toBe(0)
  })

  it("includes the other side of an accepted request, for both people", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const req = await sendFriendRequest(a, b)
    await acceptFriendRequest(req.id, b)
    expect((await connectedUserIds(a)).has(b)).toBe(true)
    expect((await connectedUserIds(b)).has(a)).toBe(true)
  })

  it("does not include the other side of a merely-pending request", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    await sendFriendRequest(a, b)
    expect((await connectedUserIds(a)).has(b)).toBe(false)
    expect((await connectedUserIds(b)).has(a)).toBe(false)
  })

  it("includes a pre-existing 1:1 DM peer even with no friend request at all (grandfathering)", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    await findOrCreateDm([a, b])
    expect((await connectedUserIds(a)).has(b)).toBe(true)
  })

  it("does not treat group-DM co-membership as a 1:1 connection", async () => {
    const a = await seedUser("alice")
    const b = await seedUser("bob")
    const c = await seedUser("carol")
    await findOrCreateDm([a, b, c])
    expect((await connectedUserIds(a)).has(b)).toBe(false)
    expect((await connectedUserIds(a)).has(c)).toBe(false)
  })
})
