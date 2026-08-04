import { afterEach, beforeEach, describe, expect, it } from "vitest"

const { POST: claimHostPost } = await import("./route")
const { deriveHostKey } = await import("@/lib/server/slug")

const SLUG = "1234567890"

function req(body: unknown, opts: { ip?: string } = {}): Request {
  return new Request(`http://x/api/rooms/${SLUG}/claim-host`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.ip ? { "x-forwarded-for": opts.ip } : {}),
    },
    body: JSON.stringify(body),
  })
}

function params(slug = SLUG) {
  return { params: Promise.resolve({ slug }) }
}

const originalPassword = process.env.MEET_MANAGEMENT_PASSWORD

describe("claim-host route", () => {
  beforeEach(() => {
    process.env.MEET_ROOM_SECRET = "test-room-secret-0123456789abcdef"
  })
  afterEach(() => {
    if (originalPassword === undefined) {
      delete process.env.MEET_MANAGEMENT_PASSWORD
    } else {
      process.env.MEET_MANAGEMENT_PASSWORD = originalPassword
    }
  })

  it("rejects an invalid slug", async () => {
    const res = await claimHostPost(
      req({ password: "x" }, { ip: "203.0.113.1" }),
      params("not a slug!"),
    )
    expect(res.status).toBe(400)
  })

  it("hands out the derived host key with no password configured", async () => {
    delete process.env.MEET_MANAGEMENT_PASSWORD
    const res = await claimHostPost(req({}, { ip: "203.0.113.2" }), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hostKey).toBe(deriveHostKey(SLUG))
  })

  it("rejects a wrong password", async () => {
    process.env.MEET_MANAGEMENT_PASSWORD = "correct-horse"
    const res = await claimHostPost(
      req({ password: "wrong" }, { ip: "203.0.113.3" }),
      params(),
    )
    expect(res.status).toBe(401)
  })

  it("accepts the correct password and returns the matching host key", async () => {
    process.env.MEET_MANAGEMENT_PASSWORD = "correct-horse"
    const res = await claimHostPost(
      req({ password: "correct-horse" }, { ip: "203.0.113.4" }),
      params(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hostKey).toBe(deriveHostKey(SLUG))
  })

  it("rate-limits repeated attempts from the same client", async () => {
    process.env.MEET_MANAGEMENT_PASSWORD = "correct-horse"
    const ip = "203.0.113.5"
    let lastStatus = 0
    for (let i = 0; i < 11; i++) {
      const res = await claimHostPost(
        req({ password: "wrong" }, { ip }),
        params(),
      )
      lastStatus = res.status
      if (i < 10) expect(res.status).toBe(401)
    }
    expect(lastStatus).toBe(429)
  })

  it("does not rate-limit a different client", async () => {
    process.env.MEET_MANAGEMENT_PASSWORD = "correct-horse"
    const exhausted = "203.0.113.6"
    for (let i = 0; i < 10; i++) {
      await claimHostPost(
        req({ password: "wrong" }, { ip: exhausted }),
        params(),
      )
    }
    const blocked = await claimHostPost(
      req({ password: "wrong" }, { ip: exhausted }),
      params(),
    )
    expect(blocked.status).toBe(429)

    const other = await claimHostPost(
      req({ password: "correct-horse" }, { ip: "203.0.113.7" }),
      params(),
    )
    expect(other.status).toBe(200)
  })
})
