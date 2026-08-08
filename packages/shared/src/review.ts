import { z } from "zod"

// The review contract: what a local authoring agent pushes into a room
// (PR snapshots), what humans and agents record against it (concerns,
// decisions, revisions), and the single op vocabulary every mutation goes
// through. The bridge's review store applies ops server-side with
// actor-kind authorization — agents propose and execute, humans decide
// and verify — so these schemas are the whole wire protocol for the
// review → revise → verify loop.

// ---- limits ----------------------------------------------------------------

/** Per-file patch cap; larger files arrive truncated with a flag. */
export const MAX_PATCH_CHARS = 256_000
export const MAX_REVIEW_FILES = 500
export const MAX_REVIEW_SNAPSHOT_BYTES = 4 * 1024 * 1024
/** Concerns + revisions (patches excluded) — keeps GET /review bounded. */
export const MAX_REVIEW_STATE_BYTES = 1 * 1024 * 1024

// ---- PR snapshot -----------------------------------------------------------

export const reviewFileSchema = z.object({
  path: z.string().max(1024),
  /** Present for renames. */
  oldPath: z.string().max(1024).optional(),
  status: z.enum(["added", "modified", "deleted", "renamed", "binary"]),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  /** Unified-diff hunks for THIS file only (no `diff --git` header needed). */
  patch: z.string().max(MAX_PATCH_CHARS).optional(),
  truncated: z.boolean().optional(),
})
export type ReviewFile = z.infer<typeof reviewFileSchema>

export const prSnapshotSchema = z.object({
  /** "owner/name" */
  repo: z.string().max(256),
  number: z.number().int().positive(),
  url: z.string().max(1024).optional(),
  title: z.string().max(512),
  description: z.string().max(65_536).default(""),
  author: z.string().max(128),
  baseRef: z.string().max(256),
  headRef: z.string().max(256),
  headSha: z.string().max(64),
  linkedIssues: z
    .array(
      z.object({
        number: z.number().int(),
        title: z.string().max(512),
        url: z.string().max(1024).optional(),
      }),
    )
    .max(20)
    .default([]),
  commits: z
    .array(
      z.object({
        sha: z.string().max(64),
        title: z.string().max(512),
        author: z.string().max(128).optional(),
      }),
    )
    .max(250),
  checks: z
    .object({
      summary: z.enum(["passing", "failing", "pending", "unknown"]),
      items: z
        .array(
          z.object({
            name: z.string().max(256),
            status: z.enum(["pass", "fail", "pending", "skipped"]),
            url: z.string().max(1024).optional(),
          }),
        )
        .max(100)
        .default([]),
    })
    .optional(),
  files: z.array(reviewFileSchema).max(MAX_REVIEW_FILES),
  pushedAt: z.number(),
})
export type PrSnapshot = z.infer<typeof prSnapshotSchema>

// ---- actors, anchors, concerns, revisions ----------------------------------

export const reviewActorSchema = z.object({
  /** LiveKit identity — server-stamped by the trusted caller, never payload-trusted. */
  identity: z.string().max(128),
  name: z.string().max(128),
  kind: z.enum(["human", "agent"]),
})
export type ReviewActor = z.infer<typeof reviewActorSchema>

export const concernAnchorSchema = z.object({
  path: z.string().max(1024),
  side: z.enum(["old", "new"]),
  line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  /** headSha the anchor was raised against — flags staleness after revisions. */
  sha: z.string().max(64),
})
export type ConcernAnchor = z.infer<typeof concernAnchorSchema>

export const concernStatusSchema = z.enum([
  // raised, undecided
  "open",
  // decision: will fix (eligible for a revision instruction)
  "accepted",
  // decision: won't fix / working as intended
  "rejected",
  // agent reports a revision addressed it
  "resolved",
  // a human confirmed the fix against the new diff
  "verified",
])
export type ConcernStatus = z.infer<typeof concernStatusSchema>

export const concernSchema = z.object({
  id: z.string().max(64),
  /** Absent = PR-level concern. */
  anchor: concernAnchorSchema.optional(),
  body: z.string().max(8_000),
  raisedBy: reviewActorSchema,
  at: z.number(),
  status: concernStatusSchema,
  /** Agent-proposed concerns start unconfirmed; a human adopts or discards. */
  proposed: z.boolean().optional(),
  decision: z
    .object({
      note: z.string().max(4_000),
      by: reviewActorSchema,
      at: z.number(),
    })
    .optional(),
  revisionId: z.string().max(64).optional(),
  /** Set by revision-result. */
  resolution: z
    .object({
      note: z.string().max(4_000),
      newAnchor: concernAnchorSchema.optional(),
      at: z.number(),
    })
    .optional(),
  verifiedBy: reviewActorSchema.optional(),
})
export type Concern = z.infer<typeof concernSchema>

export const revisionResultSchema = z.object({
  summary: z.string().max(16_000),
  commits: z
    .array(z.object({ sha: z.string().max(64), title: z.string().max(512) }))
    .max(50),
  headSha: z.string().max(64),
  perConcern: z
    .array(
      z.object({
        concernId: z.string().max(64),
        note: z.string().max(4_000),
        newAnchor: concernAnchorSchema.optional(),
      }),
    )
    .max(50),
})
export type RevisionResult = z.infer<typeof revisionResultSchema>

export const revisionSchema = z.object({
  id: z.string().max(64),
  concernIds: z.array(z.string().max(64)).min(1).max(50),
  instruction: z.string().max(16_000),
  /** Which room agent executes it. */
  agentId: z.string().max(64),
  composedBy: reviewActorSchema,
  at: z.number(),
  status: z.enum(["dispatched", "working", "done", "failed"]),
  progress: z
    .array(z.object({ at: z.number(), note: z.string().max(500) }))
    .max(100)
    .default([]),
  result: revisionResultSchema.optional(),
  error: z.string().max(1_000).optional(),
})
export type Revision = z.infer<typeof revisionSchema>

/** GET /review response (patches excluded — fetched per sha separately). */
export const reviewStateSchema = z.object({
  rev: z.number().int().min(0),
  pr: prSnapshotSchema
    .omit({ files: true })
    .extend({ files: z.array(reviewFileSchema.omit({ patch: true })) })
    .nullable(),
  previousHeadSha: z.string().max(64).optional(),
  concerns: z.array(concernSchema).max(500),
  revisions: z.array(revisionSchema).max(100),
})
export type ReviewState = z.infer<typeof reviewStateSchema>

// ---- ops: the single mutation vocabulary -----------------------------------

export const reviewOpSchema = z.discriminatedUnion("op", [
  // agent only
  z.object({ op: z.literal("push-snapshot"), snapshot: prSnapshotSchema }),
  // human; agent ⇒ proposed forced true by the store
  z.object({
    op: z.literal("raise-concern"),
    id: z.string().max(64),
    anchor: concernAnchorSchema.optional(),
    body: z.string().max(8_000),
    proposed: z.boolean().optional(),
  }),
  // raiser only
  z.object({
    op: z.literal("edit-concern"),
    id: z.string().max(64),
    body: z.string().max(8_000),
  }),
  // human adopts an agent proposal
  z.object({ op: z.literal("adopt-concern"), id: z.string().max(64) }),
  // human; raiser may discard their own open concern
  z.object({ op: z.literal("discard-concern"), id: z.string().max(64) }),
  // human only
  z.object({
    op: z.literal("decide"),
    id: z.string().max(64),
    status: z.enum(["accepted", "rejected"]),
    note: z.string().max(4_000),
  }),
  // human only
  z.object({
    op: z.literal("dispatch-revision"),
    id: z.string().max(64),
    concernIds: z.array(z.string().max(64)).min(1).max(50),
    instruction: z.string().max(16_000),
    agentId: z.string().max(64),
  }),
  // agent only (its own revision)
  z.object({
    op: z.literal("revision-progress"),
    id: z.string().max(64),
    note: z.string().max(500),
  }),
  // agent only ⇒ linked concerns → resolved
  z.object({
    op: z.literal("revision-result"),
    id: z.string().max(64),
    result: revisionResultSchema,
  }),
  // agent only
  z.object({
    op: z.literal("revision-failed"),
    id: z.string().max(64),
    error: z.string().max(1_000),
  }),
  // human only; ok=false reopens → accepted
  z.object({
    op: z.literal("verify"),
    id: z.string().max(64),
    ok: z.boolean(),
    note: z.string().max(4_000).optional(),
  }),
])
export type ReviewOp = z.infer<typeof reviewOpSchema>

/** POST body to the bridge — the actor is stamped by the trusted caller (web route / worker). */
export const reviewOpEnvelopeSchema = z.object({
  actor: reviewActorSchema,
  op: reviewOpSchema,
})
export type ReviewOpEnvelope = z.infer<typeof reviewOpEnvelopeSchema>

/** Ops only an agent may post; the web route rejects them outright. */
export const AGENT_ONLY_REVIEW_OPS: ReadonlySet<ReviewOp["op"]> = new Set([
  "push-snapshot",
  "revision-progress",
  "revision-result",
  "revision-failed",
])

/** Ops the host may reserve via roomSettings.participantsCanResolveReviews. */
export const HOST_RESERVABLE_REVIEW_OPS: ReadonlySet<ReviewOp["op"]> = new Set([
  "decide",
  "dispatch-revision",
  "verify",
])
