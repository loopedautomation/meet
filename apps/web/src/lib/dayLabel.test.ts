import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { dayLabel, isSameDay } from "./dayLabel"

describe("dayLabel", () => {
  beforeEach(() => {
    // Fixed "now" so Today/Yesterday/fallback are deterministic.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 17, 15, 0, 0)) // 17 August 2026, 15:00 local
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("labels a timestamp from earlier today as Today", () => {
    const earlierToday = new Date(2026, 7, 17, 9, 30, 0).getTime()
    expect(dayLabel(earlierToday)).toBe("Today")
  })

  it("labels a timestamp from the previous calendar day as Yesterday", () => {
    const yesterday = new Date(2026, 7, 16, 22, 0, 0).getTime()
    expect(dayLabel(yesterday)).toBe("Yesterday")
  })

  it("falls back to a full day/long-month/year date for anything older", () => {
    const older = new Date(2026, 7, 10, 12, 0, 0).getTime() // 10 August 2026
    expect(dayLabel(older)).toBe("10 August 2026")
  })

  it("includes the year in the fallback even when it matches the current year", () => {
    // Regression guard: the old helper omitted the year when it matched
    // "now"'s year — the issue's own example ("17 August 2026") always
    // includes it, so the fallback must too, unconditionally.
    const sameYear = new Date(2026, 0, 2, 12, 0, 0).getTime() // 2 January 2026
    expect(dayLabel(sameYear)).toBe("2 January 2026")
  })
})

// TextChannelView's day-separator placement reuses this directly (rather
// than reimplementing the same-day comparison) so the two never disagree
// about where a day boundary falls — see #299.
describe("isSameDay", () => {
  it("is true for two timestamps on the same local calendar day", () => {
    const morning = new Date(2026, 7, 17, 0, 1, 0)
    const night = new Date(2026, 7, 17, 23, 59, 0)
    expect(isSameDay(morning, night)).toBe(true)
  })

  it("is false across a midnight boundary even a minute apart", () => {
    const justBefore = new Date(2026, 7, 17, 23, 59, 0)
    const justAfter = new Date(2026, 7, 18, 0, 0, 0)
    expect(isSameDay(justBefore, justAfter)).toBe(false)
  })
})
