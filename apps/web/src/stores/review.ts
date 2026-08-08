import { atom, map } from "nanostores"
import type { ReviewState } from "@meet/shared/review"

export const $review = atom<ReviewState | null>(null)
export const $reviewSnapshots = map<Record<string, unknown>>({})
export const $reviewFocus = atom<{ path: string; line?: number; side?: string; at: number } | null>(null)
export const $followReview = atom<boolean>(true)

let lastRev = -1

let _reviewSlug: string | null = null
export function setReviewSlug(slug: string) { _reviewSlug = slug }

export async function fetchReviewState(slug?: string, token?: string): Promise<void> {
  const effectiveSlug = slug ?? _reviewSlug
  if (!effectiveSlug) return
  const headers: Record<string,string> = {}
  // Prefer explicit token, else use roomAuthHeaders (LiveKit JWT + host key) like doc/canvas do
  if (token) headers.authorization = `Bearer ${token}`
  else {
    try {
      const { roomAuthHeaders } = await import("@/lib/roomAuth")
      Object.assign(headers, roomAuthHeaders(effectiveSlug))
    } catch {}
  }
  const res = await fetch(`/api/rooms/${encodeURIComponent(effectiveSlug)}/review`, {
    headers,
  })
  if (!res.ok) return
  const data = (await res.json()) as ReviewState
  if (data.rev > lastRev) {
    lastRev = data.rev
    $review.set(data)
  }
}

export async function fetchSnapshot(slug: string, token: string, sha: string): Promise<unknown | null> {
  const existing = $reviewSnapshots.get()[sha]
  if (existing) return existing
  const res = await fetch(`/api/rooms/${encodeURIComponent(slug)}/review/pr?sha=${encodeURIComponent(sha)}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { snapshot: unknown }
  $reviewSnapshots.setKey(sha, data.snapshot)
  return data.snapshot
}

export async function postReviewOp(slug: string, token: string, op: unknown, hostKey?: string): Promise<{ ok: boolean; rev?: number; error?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(slug)}/review/ops`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(hostKey ? { "x-host-key": hostKey } : {}),
    },
    body: JSON.stringify(op),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) return { ok: false, error: String(data.error ?? "failed") }
  return { ok: true, rev: data.rev as number }
}

export function resetReview() { $review.set(null); $reviewSnapshots.set({} as Record<string, unknown>); }

export function setReviewFocus(focus: { path: string; line?: number; side?: string; at: number } | null) { $reviewFocus.set(focus) }
