import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isKicked, recordKicked } from "./kicked"

describe("kicked store", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reports a freshly kicked identity as kicked", () => {
    recordKicked("room-a", "user-1")
    expect(isKicked("room-a", "user-1")).toBe(true)
  })

  it("scopes kicks per room and per identity", () => {
    recordKicked("room-b", "user-2")
    expect(isKicked("room-b", "user-3")).toBe(false)
    expect(isKicked("room-c", "user-2")).toBe(false)
  })

  it("expires a kick after its TTL so a slug can be reused later", () => {
    recordKicked("room-d", "user-4")
    expect(isKicked("room-d", "user-4")).toBe(true)
    // TTL is 3h; step just past it.
    vi.advanceTimersByTime(3 * 60 * 60 * 1000 + 1)
    expect(isKicked("room-d", "user-4")).toBe(false)
  })

  it("keeps the kick within the TTL window", () => {
    recordKicked("room-e", "user-5")
    vi.advanceTimersByTime(2 * 60 * 60 * 1000)
    expect(isKicked("room-e", "user-5")).toBe(true)
  })
})
