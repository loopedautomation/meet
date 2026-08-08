import type { PrSnapshot, ReviewOp, ReviewState } from "@meet/shared/review"
import { atom, map } from "nanostores"
import { readHostKey } from "@/lib/hostKey"
import { roomAuthHeaders } from "@/lib/roomAuth"

// Client replica of the room's review state. Bulk rides HTTP (the bridge
// review store, via the proxied routes); DataTopic.Review carries only
// "state changed" pings and presenter focus. Components mutate through
// useReviewOps (hooks/useReviewOps.ts), which posts the op, broadcasts the
// sync ping, and refetches — plain fetches here never mutate.

export const $review = atom<ReviewState | null>(null)
export const $reviewSnapshots = map<Record<string, PrSnapshot>>({})
export const $reviewFocus = atom<{
  path: string
  line?: number
  side?: "old" | "new"
  at: number
} | null>(null)
export const $followReview = atom<boolean>(true)

/**
 * Highest rev applied, so a slow response can't clobber a newer one.
 * Per-room state — reset alongside the atoms or a rejoined room whose rev
 * restarts lower would never load.
 */
let lastRev = -1

let reviewSlug: string | null = null
export function setReviewSlug(slug: string) {
  if (reviewSlug !== slug) {
    reviewSlug = slug
    lastRev = -1
  }
}

function authHeaders(slug: string): Record<string, string> {
  const hostKey = readHostKey(slug)
  return {
    ...roomAuthHeaders(slug),
    ...(hostKey ? { "x-host-key": hostKey } : {}),
  }
}

export async function fetchReviewState(slug?: string): Promise<void> {
  const effectiveSlug = slug ?? reviewSlug
  if (!effectiveSlug) return
  const res = await fetch(
    `/api/rooms/${encodeURIComponent(effectiveSlug)}/review`,
    { headers: authHeaders(effectiveSlug) },
  )
  if (!res.ok) return
  const data = (await res.json()) as ReviewState
  if (data.rev > lastRev) {
    lastRev = data.rev
    $review.set(data)
  }
}

export async function fetchSnapshot(
  slug: string,
  sha: string,
): Promise<PrSnapshot | null> {
  const existing = $reviewSnapshots.get()[sha]
  if (existing) return existing
  const res = await fetch(
    `/api/rooms/${encodeURIComponent(slug)}/review/pr?sha=${encodeURIComponent(sha)}`,
    { headers: authHeaders(slug) },
  )
  if (!res.ok) return null
  const data = (await res.json()) as { snapshot: PrSnapshot }
  $reviewSnapshots.setKey(sha, data.snapshot)
  return data.snapshot
}

/**
 * Post one review op as the caller. Authorization rides the caller's own
 * LiveKit token (roomAuthHeaders) — the route stamps the actor from it.
 * Prefer useReviewOps in components: it also broadcasts review-sync so the
 * rest of the room (and the executing agent) hears about the change.
 */
export async function postReviewOp(
  slug: string,
  op: ReviewOp,
): Promise<{ ok: boolean; rev?: number; error?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(slug)}/review/ops`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(slug) },
    body: JSON.stringify(op),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) return { ok: false, error: String(data.error ?? "failed") }
  return { ok: true, rev: data.rev as number }
}

export function resetReview() {
  $review.set(null)
  $reviewSnapshots.set({})
  $reviewFocus.set(null)
  lastRev = -1
  reviewSlug = null
}

export function setReviewFocus(
  focus: {
    path: string
    line?: number
    side?: "old" | "new"
    at: number
  } | null,
) {
  $reviewFocus.set(focus)
}
