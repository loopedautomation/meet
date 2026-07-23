/**
 * Small in-memory sliding-window limiter for abuse-prone endpoints (room
 * recreation). Per-process, like the kicked store: right for the
 * single-instance deployments this app targets.
 */
const buckets = new Map<string, number[]>()

export function rateLimited(
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now()
  const times = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (times.length >= max) {
    buckets.set(key, times)
    return true
  }
  times.push(now)
  buckets.set(key, times)
  // Opportunistic sweep so idle keys don't accumulate forever.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k)
    }
  }
  return false
}

/** Best-effort client key: first XFF hop, else a shared bucket. */
export function clientKey(request: Request): string {
  const xff = request.headers.get("x-forwarded-for")
  return xff?.split(",")[0]?.trim() || "unknown"
}
