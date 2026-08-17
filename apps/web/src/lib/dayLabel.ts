/**
 * Whether two timestamps fall on the same local calendar day — the single
 * definition of "day boundary" shared by `dayLabel` below and
 * `TextChannelView`'s day-separator placement, so the two can never
 * disagree about where a boundary falls.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

/**
 * Human-readable day label for a message/search-result timestamp, shared by
 * `ChannelSearchPanel`'s day grouping and `TextChannelView`'s day
 * separators — single source of truth so the two never drift apart.
 * "Today" / "Yesterday" for the two most recent days, otherwise the full
 * "17 August 2026" style used across the app. Locale is pinned (rather than
 * left to the runtime's default) so the day/month order is deterministic
 * across environments, matching the app's own convention.
 */
export function dayLabel(at: number): string {
  const d = new Date(at)
  const today = new Date()
  if (isSameDay(d, today)) return "Today"
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(d, yesterday)) return "Yesterday"
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}
