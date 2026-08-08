import type {
  Concern,
  PrSnapshot,
  ReviewState,
  Revision,
} from "@meet/shared/review"
import {
  MAX_REVIEW_SNAPSHOT_BYTES,
  MAX_REVIEW_STATE_BYTES,
  reviewOpEnvelopeSchema,
} from "@meet/shared/review"

// The room's review working memory: PR snapshots pushed by the authoring
// agent plus the concern/decision/revision ledger. Modeled on the doc and
// canvas stores in index.ts — in-memory, TTL-swept, globally capped — with
// one addition: every mutation is a typed op applied HERE, validated
// against the server-stamped actor. Agents propose and execute; humans
// decide and verify. The web route pre-filters and the worker only ever
// stamps kind "agent", but this applier is the authority (defense in
// depth), so a compromised or buggy caller still can't cross the line.
//
// Durability: GitHub (via the agent's own gh write-back) is the system of
// record; losing this store to a restart costs the in-room ledger only.

const REVIEW_TTL_MS = 24 * 60 * 60 * 1000
const MAX_REVIEW_ROOMS = 200
/** Current + previous snapshot — previous kept for stale-anchor detection. */
const MAX_SNAPSHOTS = 2
const MAX_CONCERNS = 500
const MAX_REVISIONS = 100
const MAX_PROGRESS = 100

type ReviewEntry = {
  updatedAt: number
  rev: number
  /** Newest first; bounded to MAX_SNAPSHOTS. */
  shaOrder: string[]
  snapshots: Map<string, PrSnapshot>
  concerns: Concern[]
  revisions: Revision[]
}

const reviews = new Map<string, ReviewEntry>()

export type ApplyResult =
  | { ok: true; rev: number }
  | { ok: false; status: 400 | 403 | 404 | 409 | 413; error: string }

function entryFor(room: string): ReviewEntry {
  let entry = reviews.get(room)
  if (!entry) {
    if (reviews.size >= MAX_REVIEW_ROOMS) evictOldest()
    entry = {
      updatedAt: Date.now(),
      rev: 0,
      shaOrder: [],
      snapshots: new Map(),
      concerns: [],
      revisions: [],
    }
    reviews.set(room, entry)
  }
  return entry
}

function evictOldest(): void {
  let oldest: string | null = null
  let oldestAt = Number.POSITIVE_INFINITY
  for (const [room, entry] of reviews) {
    if (entry.updatedAt < oldestAt) {
      oldestAt = entry.updatedAt
      oldest = room
    }
  }
  if (oldest) reviews.delete(oldest)
}

setInterval(
  () => {
    const cutoff = Date.now() - REVIEW_TTL_MS
    for (const [room, entry] of reviews) {
      if (entry.updatedAt < cutoff) reviews.delete(room)
    }
  },
  60 * 60 * 1000,
).unref()

/** Patches stripped — clients fetch full snapshots per sha separately. */
export function getReviewState(room: string): ReviewState {
  const entry = reviews.get(room)
  if (!entry) return { rev: 0, pr: null, concerns: [], revisions: [] }
  const currentSha = entry.shaOrder[0]
  const current = currentSha ? entry.snapshots.get(currentSha) : undefined
  return {
    rev: entry.rev,
    pr: current
      ? {
          ...current,
          files: current.files.map(({ patch: _patch, ...file }) => file),
        }
      : null,
    ...(entry.shaOrder[1] ? { previousHeadSha: entry.shaOrder[1] } : {}),
    concerns: entry.concerns,
    revisions: entry.revisions,
  }
}

/** Full snapshot with patches; only the current or previous sha is served. */
export function getReviewSnapshot(
  room: string,
  sha: string,
): PrSnapshot | null {
  const entry = reviews.get(room)
  if (!entry || !entry.shaOrder.includes(sha)) return null
  return entry.snapshots.get(sha) ?? null
}

function findConcern(entry: ReviewEntry, id: string): Concern | undefined {
  return entry.concerns.find((c) => c.id === id)
}

function findRevision(entry: ReviewEntry, id: string): Revision | undefined {
  return entry.revisions.find((r) => r.id === id)
}

/** The agent identity that owns a revision, e.g. "agent-local-ab12cd34". */
function ownsRevision(actorIdentity: string, revision: Revision): boolean {
  return actorIdentity === `agent-${revision.agentId}`
}

/**
 * Apply one review op. The envelope's actor was stamped by a trusted
 * caller — the web route (verified LiveKit participant, kind "human") or
 * the agent worker (kind "agent") — and is never client-claimed.
 */
export function applyReviewOp(room: string, raw: unknown): ApplyResult {
  const parsed = reviewOpEnvelopeSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      status: 400,
      error: `invalid op (${issue?.path.join(".")}: ${issue?.message})`,
    }
  }
  const { actor, op } = parsed.data
  const entry = entryFor(room)
  const now = Date.now()

  const done = (): ApplyResult => {
    entry.updatedAt = now
    entry.rev += 1
    return { ok: true, rev: entry.rev }
  }
  const fail = (status: 400 | 403 | 404 | 409 | 413, error: string): ApplyResult => ({
    ok: false,
    status,
    error,
  })

  switch (op.op) {
    case "push-snapshot": {
      if (actor.kind !== "agent")
        return fail(403, "only the authoring agent can push a PR snapshot")
      const bytes = Buffer.byteLength(JSON.stringify(op.snapshot))
      if (bytes > MAX_REVIEW_SNAPSHOT_BYTES)
        return fail(413, "snapshot too large")
      const current = entry.shaOrder[0]
        ? entry.snapshots.get(entry.shaOrder[0])
        : undefined
      if (
        current &&
        (current.repo !== op.snapshot.repo ||
          current.number !== op.snapshot.number)
      ) {
        // One PR per room in v1 — a different PR replaces the whole review.
        entry.shaOrder = []
        entry.snapshots.clear()
        entry.concerns = []
        entry.revisions = []
      }
      const sha = op.snapshot.headSha
      entry.snapshots.set(sha, op.snapshot)
      entry.shaOrder = [sha, ...entry.shaOrder.filter((s) => s !== sha)]
      while (entry.shaOrder.length > MAX_SNAPSHOTS) {
        const dropped = entry.shaOrder.pop()
        if (dropped) entry.snapshots.delete(dropped)
      }
      return done()
    }

    case "raise-concern": {
      if (findConcern(entry, op.id)) return fail(409, "concern id already exists")
      if (entry.concerns.length >= MAX_CONCERNS)
        return fail(413, "too many concerns")
      const stateBytes = Buffer.byteLength(
        JSON.stringify({ c: entry.concerns, r: entry.revisions }),
      )
      if (stateBytes > MAX_REVIEW_STATE_BYTES)
        return fail(413, "review ledger too large")
      entry.concerns.push({
        id: op.id,
        ...(op.anchor ? { anchor: op.anchor } : {}),
        body: op.body,
        raisedBy: actor,
        at: now,
        status: "open",
        // Agents never raise confirmed concerns — a human adopts or discards.
        ...(actor.kind === "agent" || op.proposed ? { proposed: true } : {}),
      })
      return done()
    }

    case "edit-concern": {
      const concern = findConcern(entry, op.id)
      if (!concern) return fail(404, "no such concern")
      if (concern.raisedBy.identity !== actor.identity)
        return fail(403, "only the raiser can edit a concern")
      if (concern.status !== "open")
        return fail(409, "only open concerns can be edited")
      concern.body = op.body
      return done()
    }

    case "adopt-concern": {
      if (actor.kind !== "human")
        return fail(403, "only humans adopt proposed concerns")
      const concern = findConcern(entry, op.id)
      if (!concern) return fail(404, "no such concern")
      if (!concern.proposed) return fail(409, "concern is not a proposal")
      concern.proposed = undefined
      return done()
    }

    case "discard-concern": {
      if (actor.kind !== "human")
        return fail(403, "only humans discard concerns")
      const concern = findConcern(entry, op.id)
      if (!concern) return fail(404, "no such concern")
      const own = concern.raisedBy.identity === actor.identity
      if (!concern.proposed && !own)
        return fail(403, "only the raiser can discard an adopted concern")
      if (concern.status !== "open")
        return fail(409, "only open concerns can be discarded")
      entry.concerns = entry.concerns.filter((c) => c.id !== op.id)
      return done()
    }

    case "decide": {
      if (actor.kind !== "human")
        return fail(403, "agents propose, humans decide")
      const concern = findConcern(entry, op.id)
      if (!concern) return fail(404, "no such concern")
      if (concern.proposed)
        return fail(409, "adopt the proposed concern before deciding")
      if (concern.revisionId)
        return fail(409, "concern is already in a revision")
      if (!["open", "accepted", "rejected"].includes(concern.status))
        return fail(409, `cannot decide a ${concern.status} concern`)
      concern.status = op.status
      concern.decision = { note: op.note, by: actor, at: now }
      return done()
    }

    case "dispatch-revision": {
      if (actor.kind !== "human")
        return fail(403, "only humans dispatch revisions")
      if (findRevision(entry, op.id))
        return fail(409, "revision id already exists")
      if (entry.revisions.length >= MAX_REVISIONS)
        return fail(413, "too many revisions")
      const active = entry.revisions.find(
        (r) =>
          r.agentId === op.agentId &&
          (r.status === "dispatched" || r.status === "working"),
      )
      if (active)
        return fail(409, `agent already has revision ${active.id} in flight`)
      const concerns: Concern[] = []
      for (const id of op.concernIds) {
        const concern = findConcern(entry, id)
        if (!concern) return fail(404, `no such concern: ${id}`)
        if (concern.status !== "accepted")
          return fail(409, `concern ${id} is ${concern.status}, not accepted`)
        concerns.push(concern)
      }
      entry.revisions.push({
        id: op.id,
        concernIds: op.concernIds,
        instruction: op.instruction,
        agentId: op.agentId,
        composedBy: actor,
        at: now,
        status: "dispatched",
        progress: [],
      })
      for (const concern of concerns) concern.revisionId = op.id
      return done()
    }

    case "revision-progress": {
      const revision = findRevision(entry, op.id)
      if (!revision) return fail(404, "no such revision")
      if (actor.kind !== "agent" || !ownsRevision(actor.identity, revision))
        return fail(403, "only the executing agent reports progress")
      if (revision.status === "done" || revision.status === "failed")
        return fail(409, "revision already finished")
      revision.status = "working"
      revision.progress.push({ at: now, note: op.note })
      if (revision.progress.length > MAX_PROGRESS) revision.progress.shift()
      return done()
    }

    case "revision-result": {
      const revision = findRevision(entry, op.id)
      if (!revision) return fail(404, "no such revision")
      if (actor.kind !== "agent" || !ownsRevision(actor.identity, revision))
        return fail(403, "only the executing agent reports results")
      if (revision.status === "done" || revision.status === "failed")
        return fail(409, "revision already finished")
      revision.status = "done"
      revision.result = op.result
      for (const concernId of revision.concernIds) {
        const concern = findConcern(entry, concernId)
        if (!concern) continue
        const mapped = op.result.perConcern.find(
          (p) => p.concernId === concernId,
        )
        concern.status = "resolved"
        concern.resolution = {
          note: mapped?.note ?? op.result.summary.slice(0, 4000),
          ...(mapped?.newAnchor ? { newAnchor: mapped.newAnchor } : {}),
          at: now,
        }
      }
      return done()
    }

    case "revision-failed": {
      const revision = findRevision(entry, op.id)
      if (!revision) return fail(404, "no such revision")
      if (actor.kind !== "agent" || !ownsRevision(actor.identity, revision))
        return fail(403, "only the executing agent reports failure")
      if (revision.status === "done" || revision.status === "failed")
        return fail(409, "revision already finished")
      revision.status = "failed"
      revision.error = op.error
      // Free the concerns so a retry can dispatch them again.
      for (const concernId of revision.concernIds) {
        const concern = findConcern(entry, concernId)
        if (concern && concern.status !== "resolved")
          concern.revisionId = undefined
      }
      return done()
    }

    case "verify": {
      if (actor.kind !== "human")
        return fail(403, "verification is the human's job")
      const concern = findConcern(entry, op.id)
      if (!concern) return fail(404, "no such concern")
      if (concern.status !== "resolved")
        return fail(409, `cannot verify a ${concern.status} concern`)
      if (op.ok) {
        concern.status = "verified"
        concern.verifiedBy = actor
      } else {
        // Reopen for another round; the resolution stays as the last attempt.
        concern.status = "accepted"
        concern.revisionId = undefined
        if (op.note && concern.resolution) {
          concern.resolution.note = `${concern.resolution.note}\n[verification failed: ${op.note}]`
        }
      }
      return done()
    }
  }
}

/** Fetch a revision (worker-side dispatch pickup). */
export function getRevision(room: string, id: string): Revision | null {
  const entry = reviews.get(room)
  return entry ? (findRevision(entry, id) ?? null) : null
}

export function _testResetReviews(): void {
  reviews.clear()
}
