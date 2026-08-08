import type { PrSnapshot } from "@meet/shared/review"
import { beforeEach, describe, expect, it } from "vitest"
import {
  _testResetReviews,
  applyReviewOp,
  getReviewSnapshot,
  getReviewState,
} from "./review-store.js"

const human = { identity: "u-ada", name: "Ada", kind: "human" as const }
const otherHuman = { identity: "u-bob", name: "Bob", kind: "human" as const }
const agent = {
  identity: "agent-local-ab12cd34",
  name: "Ada's Claude Code",
  kind: "agent" as const,
}

const snapshot = (headSha: string): PrSnapshot => ({
  repo: "acme/widgets",
  number: 7,
  title: "Add frobnicator",
  description: "",
  author: "octocat",
  baseRef: "main",
  headRef: "feat/frob",
  headSha,
  linkedIssues: [],
  commits: [{ sha: headSha, title: "frobnicate" }],
  files: [
    {
      path: "src/frob.ts",
      status: "modified",
      additions: 5,
      deletions: 1,
      patch: "@@ -1,2 +1,6 @@\n-old\n+new\n",
    },
  ],
  pushedAt: 1,
})

const apply = (op: unknown, actor = human) =>
  applyReviewOp("room1", { actor, op })

beforeEach(() => _testResetReviews())

describe("push-snapshot", () => {
  it("is agent-only", () => {
    const res = apply({ op: "push-snapshot", snapshot: snapshot("aaa") })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(403)
  })

  it("keeps current and previous snapshots only", () => {
    for (const sha of ["aaa", "bbb", "ccc"]) {
      expect(apply({ op: "push-snapshot", snapshot: snapshot(sha) }, agent).ok).toBe(true)
    }
    const state = getReviewState("room1")
    expect(state.pr?.headSha).toBe("ccc")
    expect(state.previousHeadSha).toBe("bbb")
    expect(getReviewSnapshot("room1", "aaa")).toBeNull()
    expect(getReviewSnapshot("room1", "bbb")?.headSha).toBe("bbb")
  })

  it("strips patches from state but serves them per sha", () => {
    apply({ op: "push-snapshot", snapshot: snapshot("aaa") }, agent)
    expect(getReviewState("room1").pr?.files[0]).not.toHaveProperty("patch")
    expect(getReviewSnapshot("room1", "aaa")?.files[0].patch).toContain("+new")
  })

  it("a different PR resets the ledger", () => {
    apply({ op: "push-snapshot", snapshot: snapshot("aaa") }, agent)
    apply({ op: "raise-concern", id: "c1", body: "hm" })
    apply(
      { op: "push-snapshot", snapshot: { ...snapshot("zzz"), number: 8 } },
      agent,
    )
    expect(getReviewState("room1").concerns).toHaveLength(0)
  })
})

describe("concern lifecycle", () => {
  beforeEach(() => {
    apply({ op: "push-snapshot", snapshot: snapshot("aaa") }, agent)
  })

  it("agent-raised concerns are forced to proposed", () => {
    apply({ op: "raise-concern", id: "c1", body: "possible bug" }, agent)
    const concern = getReviewState("room1").concerns[0]
    expect(concern.proposed).toBe(true)
    // Deciding a proposal is blocked until a human adopts it.
    const decide = apply({ op: "decide", id: "c1", status: "accepted", note: "x" })
    expect(decide.ok).toBe(false)
    expect(apply({ op: "adopt-concern", id: "c1" }).ok).toBe(true)
    expect(apply({ op: "decide", id: "c1", status: "accepted", note: "x" }).ok).toBe(true)
  })

  it("agents cannot decide or verify", () => {
    apply({ op: "raise-concern", id: "c1", body: "hm" })
    expect(apply({ op: "decide", id: "c1", status: "accepted", note: "" }, agent).ok).toBe(false)
    expect(apply({ op: "verify", id: "c1", ok: true }, agent).ok).toBe(false)
  })

  it("only the raiser edits, and only while open", () => {
    apply({ op: "raise-concern", id: "c1", body: "hm" })
    expect(apply({ op: "edit-concern", id: "c1", body: "hm!" }, otherHuman).ok).toBe(false)
    expect(apply({ op: "edit-concern", id: "c1", body: "hm!" }).ok).toBe(true)
  })
})

describe("closed loop", () => {
  beforeEach(() => {
    apply({ op: "push-snapshot", snapshot: snapshot("aaa") }, agent)
    apply({ op: "raise-concern", id: "c1", body: "off-by-one" })
    apply({ op: "decide", id: "c1", status: "accepted", note: "fix it" })
  })

  const dispatch = () =>
    apply({
      op: "dispatch-revision",
      id: "r1",
      concernIds: ["c1"],
      instruction: "fix the off-by-one",
      agentId: "local-ab12cd34",
    })

  it("dispatch requires accepted concerns", () => {
    apply({ op: "raise-concern", id: "c2", body: "open one" })
    const res = apply({
      op: "dispatch-revision",
      id: "r1",
      concernIds: ["c2"],
      instruction: "x",
      agentId: "local-ab12cd34",
    })
    expect(res.ok).toBe(false)
  })

  it("one active revision per agent", () => {
    expect(dispatch().ok).toBe(true)
    const second = apply({
      op: "dispatch-revision",
      id: "r2",
      concernIds: ["c1"],
      instruction: "x",
      agentId: "local-ab12cd34",
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.status).toBe(409)
  })

  it("progress and result are owner-agent-only", () => {
    dispatch()
    const stranger = { ...agent, identity: "agent-local-ffffffff" }
    expect(apply({ op: "revision-progress", id: "r1", note: "hi" }, stranger).ok).toBe(false)
    expect(apply({ op: "revision-progress", id: "r1", note: "hi" }).ok).toBe(false)
    expect(apply({ op: "revision-progress", id: "r1", note: "hi" }, agent).ok).toBe(true)
    expect(getReviewState("room1").revisions[0].status).toBe("working")
  })

  it("result resolves linked concerns with per-concern notes", () => {
    dispatch()
    apply(
      {
        op: "revision-result",
        id: "r1",
        result: {
          summary: "did the thing",
          commits: [{ sha: "bbb", title: "fix" }],
          headSha: "bbb",
          perConcern: [
            {
              concernId: "c1",
              note: "bounds check added",
              newAnchor: { path: "src/frob.ts", side: "new", line: 9, sha: "bbb" },
            },
          ],
        },
      },
      agent,
    )
    const state = getReviewState("room1")
    expect(state.revisions[0].status).toBe("done")
    expect(state.concerns[0].status).toBe("resolved")
    expect(state.concerns[0].resolution?.note).toBe("bounds check added")
    expect(state.concerns[0].resolution?.newAnchor?.line).toBe(9)
  })

  it("verify ok → verified; verify not-ok reopens for another round", () => {
    dispatch()
    apply(
      {
        op: "revision-result",
        id: "r1",
        result: { summary: "s", commits: [], headSha: "bbb", perConcern: [] },
      },
      agent,
    )
    expect(apply({ op: "verify", id: "c1", ok: false, note: "still wrong" }).ok).toBe(true)
    let concern = getReviewState("room1").concerns[0]
    expect(concern.status).toBe("accepted")
    expect(concern.revisionId).toBeUndefined()
    // Second round can dispatch again (r1 finished).
    expect(
      apply({
        op: "dispatch-revision",
        id: "r2",
        concernIds: ["c1"],
        instruction: "try again",
        agentId: "local-ab12cd34",
      }).ok,
    ).toBe(true)
    apply(
      {
        op: "revision-result",
        id: "r2",
        result: { summary: "s2", commits: [], headSha: "ccc", perConcern: [] },
      },
      agent,
    )
    expect(apply({ op: "verify", id: "c1", ok: true }).ok).toBe(true)
    concern = getReviewState("room1").concerns[0]
    expect(concern.status).toBe("verified")
    expect(concern.verifiedBy?.identity).toBe(human.identity)
  })

  it("failure frees concerns for retry", () => {
    dispatch()
    apply({ op: "revision-failed", id: "r1", error: "agent disconnected" }, agent)
    const state = getReviewState("room1")
    expect(state.revisions[0].status).toBe("failed")
    expect(state.concerns[0].revisionId).toBeUndefined()
    expect(
      apply({
        op: "dispatch-revision",
        id: "r2",
        concernIds: ["c1"],
        instruction: "retry",
        agentId: "local-ab12cd34",
      }).ok,
    ).toBe(true)
  })
})

describe("rev monotonicity", () => {
  it("every applied op bumps rev; rejected ops don't", () => {
    apply({ op: "push-snapshot", snapshot: snapshot("aaa") }, agent)
    const before = getReviewState("room1").rev
    apply({ op: "verify", id: "nope", ok: true })
    expect(getReviewState("room1").rev).toBe(before)
    apply({ op: "raise-concern", id: "c1", body: "x" })
    expect(getReviewState("room1").rev).toBe(before + 1)
  })
})
