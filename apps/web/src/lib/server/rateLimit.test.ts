import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clientKey, rateLimited } from "./rateLimit"

describe("rateLimited", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("allows up to the limit then blocks within the window", () => {
    const key = `k-${Math.random()}`
    for (let i = 0; i < 3; i++) {
      expect(rateLimited(key, 3, 1000)).toBe(false)
    }
    expect(rateLimited(key, 3, 1000)).toBe(true)
  })

  it("frees the bucket once the window passes", () => {
    const key = `k-${Math.random()}`
    expect(rateLimited(key, 1, 1000)).toBe(false)
    expect(rateLimited(key, 1, 1000)).toBe(true)
    vi.advanceTimersByTime(1001)
    expect(rateLimited(key, 1, 1000)).toBe(false)
  })

  it("keeps separate keys independent", () => {
    const a = `a-${Math.random()}`
    const b = `b-${Math.random()}`
    expect(rateLimited(a, 1, 1000)).toBe(false)
    expect(rateLimited(a, 1, 1000)).toBe(true)
    // b has its own budget
    expect(rateLimited(b, 1, 1000)).toBe(false)
  })
})

describe("clientKey", () => {
  it("uses the first x-forwarded-for hop", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    })
    expect(clientKey(req)).toBe("203.0.113.7")
  })

  it("falls back to a shared bucket when the header is absent", () => {
    expect(clientKey(new Request("http://x"))).toBe("unknown")
  })
})
