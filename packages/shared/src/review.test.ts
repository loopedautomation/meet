import { describe, expect, it } from "vitest"
import {
  AGENT_ONLY_REVIEW_OPS,
  concernSchema,
  HOST_RESERVABLE_REVIEW_OPS,
  prSnapshotSchema,
  reviewOpEnvelopeSchema,
  reviewOpSchema,
  reviewStateSchema,
} from "./review.js"

const snapshot = {
  repo: "acme/widgets",
  number: 42,
  title: "Add frobnicator",
  author: "octocat",
  baseRef: "main",
  headRef: "feat/frobnicate",
  headSha: "abc123",
  commits: [{ sha: "abc123", title: "frobnicate" }],
  files: [
    {
      path: "src/frob.ts",
      status: "added",
      additions: 10,
      deletions: 0,
      patch: "@@ -0,0 +1,10 @@\n+export const frob = 1\n",
    },
  ],
  pushedAt: 1700000000000,
}

describe("prSnapshotSchema", () => {
  it("accepts a minimal snapshot and fills defaults", () => {
    const parsed = prSnapshotSchema.parse(snapshot)
    expect(parsed.description).toBe("")
    expect(parsed.linkedIssues).toEqual([])
    expect(parsed.files[0].patch).toContain("frob")
  })

  it("rejects a snapshot with no commits array", () => {
    const { commits: _drop, ...rest } = snapshot
    expect(prSnapshotSchema.safeParse(rest).success).toBe(false)
  })

  it("allows binary files without a patch", () => {
    const parsed = prSnapshotSchema.parse({
      ...snapshot,
      files: [
        { path: "logo.png", status: "binary", additions: 0, deletions: 0 },
      ],
    })
    expect(parsed.files[0].patch).toBeUndefined()
  })
})

describe("reviewOpSchema", () => {
  it("parses every op kind", () => {
    const actor = { identity: "u1", name: "Ada", kind: "human" as const }
    const anchor = { path: "src/frob.ts", side: "new" as const, line: 3, sha: "abc123" }
    const ops = [
      { op: "push-snapshot", snapshot },
      { op: "raise-concern", id: "c1", anchor, body: "off-by-one?" },
      { op: "edit-concern", id: "c1", body: "definitely off-by-one" },
      { op: "adopt-concern", id: "c1" },
      { op: "discard-concern", id: "c1" },
      { op: "decide", id: "c1", status: "accepted", note: "fix it" },
      {
        op: "dispatch-revision",
        id: "r1",
        concernIds: ["c1"],
        instruction: "fix the off-by-one",
        agentId: "local-abc",
      },
      { op: "revision-progress", id: "r1", note: "running tests" },
      {
        op: "revision-result",
        id: "r1",
        result: {
          summary: "fixed",
          commits: [{ sha: "def456", title: "fix" }],
          headSha: "def456",
          perConcern: [{ concernId: "c1", note: "bounds check added" }],
        },
      },
      { op: "revision-failed", id: "r1", error: "agent disconnected" },
      { op: "verify", id: "c1", ok: true },
    ]
    for (const op of ops) {
      const res = reviewOpSchema.safeParse(op)
      expect(res.success, `op ${op.op}: ${JSON.stringify(res.success ? "" : res.error.issues)}`).toBe(true)
    }
    for (const op of ops) {
      expect(reviewOpEnvelopeSchema.safeParse({ actor, op }).success).toBe(true)
    }
  })

  it("rejects unknown ops", () => {
    expect(reviewOpSchema.safeParse({ op: "merge", id: "x" }).success).toBe(
      false,
    )
  })

  it("dispatch requires at least one concern", () => {
    expect(
      reviewOpSchema.safeParse({
        op: "dispatch-revision",
        id: "r1",
        concernIds: [],
        instruction: "do it",
        agentId: "local-abc",
      }).success,
    ).toBe(false)
  })
})

describe("op classification", () => {
  it("agent-only and host-reservable sets are disjoint", () => {
    for (const op of AGENT_ONLY_REVIEW_OPS) {
      expect(HOST_RESERVABLE_REVIEW_OPS.has(op)).toBe(false)
    }
  })
})

describe("reviewStateSchema", () => {
  it("round-trips a state with patches stripped", () => {
    const { files, ...pr } = prSnapshotSchema.parse(snapshot)
    const state = {
      rev: 3,
      pr: { ...pr, files: files.map(({ patch: _p, ...f }) => f) },
      concerns: [
        concernSchema.parse({
          id: "c1",
          body: "concern",
          raisedBy: { identity: "u1", name: "Ada", kind: "human" },
          at: 1,
          status: "open",
        }),
      ],
      revisions: [],
    }
    const parsed = reviewStateSchema.parse(state)
    expect(parsed.pr?.files[0]).not.toHaveProperty("patch")
  })
})
