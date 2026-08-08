# Workstream 02 — Review surface, data model & closed loop

The PR review surface in the room, the concern/decision data model, and the
review → revision → verification loop.

Companion: [01-local-agent-connectivity.md](01-local-agent-connectivity.md) provides
the agent transport. This workstream needs nothing from it beyond ordinary brain
turns and marker blocks — the two compose without shared internals.

## Design summary

- **A review is an attachment to an ordinary room**, not a new room type. It exists
  when a PR snapshot exists in the room's review store. No route changes, no
  `roomMetadataSchema.kind` change.
- **Durable in-room state lives in a new bridge review store** (beside
  doc/canvas/transcript in `apps/agent-bridge/src/index.ts`), reached by humans
  through proxied Next routes (`verifyParticipant` pattern) and by the bridge worker
  directly. **GitHub is the durable system of record** (the agent writes the review
  summary back via its own `gh`); the room store is working memory. Postgres is a
  designed-but-deferred phase 2 (§7).
- **Transport: HTTP for bulk, data channel for notifications only.** Snapshots and
  diffs far exceed LiveKit's ~15 KB reliable-packet cap (the canvas-convert path
  already chunks at 10–12 KB to stay under it). Snapshots ride the brain WebSocket
  (no size cap) into the worker, which persists them to the store; a tiny
  `review-sync {rev}` broadcast on a new `DataTopic.Review` tells clients to
  refetch — exactly the doc pattern (broadcast + durable store + fetch-on-join).
- **State mutation is an op log applied server-side.** Clients and the worker POST
  typed ops; the store validates each op against the *stamped* actor (never
  payload-claimed), bumps a monotonic `rev`, and the actor broadcasts `review-sync`.
  This is where agent-vs-human permissions are enforced.
- **Agent integration reuses the marker-block protocol**: `<<<REVIEW … REVIEW>>>`
  JSON blocks (sibling of `doc-blocks.ts` / `canvas-blocks.ts`), which work on both
  the pipeline path and the realtime path (realtime brains reply through `do_task`,
  and `worker.ts`'s shared brain-reply path already extracts blocks).
- **UI: stage takeover for the diff (width), side panel for the concern ledger** so
  web participants can follow the ledger even while the stage shows something else.
  Diff rendering via **`@pierre/diffs`** (Apache-2.0, React 18.3/19 peers, shiki).

## 1. Contracts — new `packages/shared/src/review.ts`

Added as a subpath export in `packages/shared/package.json`
(`"./review": "./src/review.ts"` — the `calcom`/`protocol` pattern).

### 1.1 PR snapshot

```ts
import { z } from "zod"

export const MAX_PATCH_CHARS = 256_000       // per-file; truncated beyond this
export const MAX_REVIEW_FILES = 500
export const MAX_REVIEW_SNAPSHOT_BYTES = 4 * 1024 * 1024
export const MAX_REVIEW_STATE_BYTES = 1 * 1024 * 1024   // concerns/revisions sans patches

export const reviewFileSchema = z.object({
  path: z.string().max(1024),
  oldPath: z.string().max(1024).optional(),          // renames
  status: z.enum(["added", "modified", "deleted", "renamed", "binary"]),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  /** Unified-diff hunks for THIS file only (no `diff --git` header needed). */
  patch: z.string().max(MAX_PATCH_CHARS).optional(), // absent for binary
  truncated: z.boolean().optional(),
})

export const prSnapshotSchema = z.object({
  repo: z.string().max(256),                          // "owner/name"
  number: z.number().int().positive(),
  url: z.string().max(1024).optional(),
  title: z.string().max(512),
  description: z.string().max(65_536).default(""),
  author: z.string().max(128),
  baseRef: z.string().max(256),
  headRef: z.string().max(256),
  headSha: z.string().max(64),
  linkedIssues: z.array(z.object({
    number: z.number().int(), title: z.string().max(512), url: z.string().max(1024).optional(),
  })).max(20).default([]),
  commits: z.array(z.object({
    sha: z.string().max(64), title: z.string().max(512), author: z.string().max(128).optional(),
  })).max(250),
  checks: z.object({
    summary: z.enum(["passing", "failing", "pending", "unknown"]),
    items: z.array(z.object({
      name: z.string().max(256),
      status: z.enum(["pass", "fail", "pending", "skipped"]),
      url: z.string().max(1024).optional(),
    })).max(100).default([]),
  }).optional(),
  files: z.array(reviewFileSchema).max(MAX_REVIEW_FILES),
  pushedAt: z.number(),
})
export type PrSnapshot = z.infer<typeof prSnapshotSchema>
```

**Mid-meeting refresh:** after a revision the agent pushes a new snapshot (same
repo+number, new `headSha`). The store keeps the **current and previous** snapshots
(for "what changed since last round" and stale-anchor detection) and drops older
ones. Snapshots are immutable per `headSha`; clients cache by sha and only fetch a
sha they haven't seen.

### 1.2 Actors, anchors, concerns, revisions

```ts
export const reviewActorSchema = z.object({
  identity: z.string().max(128),      // LiveKit identity — server-stamped, never payload-trusted
  name: z.string().max(128),
  kind: z.enum(["human", "agent"]),
})

export const concernAnchorSchema = z.object({
  path: z.string().max(1024),
  side: z.enum(["old", "new"]),
  line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  /** headSha the anchor was raised against — flags staleness after revisions. */
  sha: z.string().max(64),
})

export const concernStatusSchema = z.enum([
  "open",       // raised, undecided
  "accepted",   // decision: will fix (eligible for a revision instruction)
  "rejected",   // decision: won't fix / working as intended
  "resolved",   // agent reports a revision addressed it
  "verified",   // a human confirmed the fix against the new diff
])

export const concernSchema = z.object({
  id: z.string().max(64),
  anchor: concernAnchorSchema.optional(),   // absent = PR-level concern
  body: z.string().max(8_000),
  raisedBy: reviewActorSchema,
  at: z.number(),
  status: concernStatusSchema,
  /** Agent-proposed concerns start unconfirmed; a human adopts or discards. */
  proposed: z.boolean().optional(),
  decision: z.object({
    note: z.string().max(4_000),
    by: reviewActorSchema, at: z.number(),
  }).optional(),
  revisionId: z.string().max(64).optional(),
  resolution: z.object({                    // set by revision-result
    note: z.string().max(4_000),
    newAnchor: concernAnchorSchema.optional(),
    at: z.number(),
  }).optional(),
  verifiedBy: reviewActorSchema.optional(),
})

export const revisionSchema = z.object({
  id: z.string().max(64),
  concernIds: z.array(z.string().max(64)).min(1).max(50),
  instruction: z.string().max(16_000),
  agentId: z.string().max(64),              // which room agent executes it
  composedBy: reviewActorSchema,
  at: z.number(),
  status: z.enum(["dispatched", "working", "done", "failed"]),
  progress: z.array(z.object({ at: z.number(), note: z.string().max(500) })).max(100).default([]),
  result: z.object({
    summary: z.string().max(16_000),
    commits: z.array(z.object({ sha: z.string().max(64), title: z.string().max(512) })).max(50),
    headSha: z.string().max(64),
    perConcern: z.array(z.object({
      concernId: z.string().max(64),
      note: z.string().max(4_000),
      newAnchor: concernAnchorSchema.optional(),
    })).max(50),
  }).optional(),
  error: z.string().max(1_000).optional(),
})

/** GET /review response (patches excluded — fetched per sha separately). */
export const reviewStateSchema = z.object({
  rev: z.number().int().min(0),
  pr: prSnapshotSchema.omit({ files: true }).extend({
    files: z.array(reviewFileSchema.omit({ patch: true })),
  }).nullable(),
  previousHeadSha: z.string().max(64).optional(),
  concerns: z.array(concernSchema).max(500),
  revisions: z.array(revisionSchema).max(100),
})
```

### 1.3 Ops — the single mutation vocabulary

```ts
export const reviewOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("push-snapshot"), snapshot: prSnapshotSchema }),      // agent only
  z.object({ op: z.literal("raise-concern"), id: z.string().max(64),
             anchor: concernAnchorSchema.optional(), body: z.string().max(8_000),
             proposed: z.boolean().optional() }),                                // human; agent ⇒ proposed forced true
  z.object({ op: z.literal("edit-concern"), id: z.string().max(64), body: z.string().max(8_000) }), // raiser only
  z.object({ op: z.literal("adopt-concern"), id: z.string().max(64) }),          // human adopts an agent proposal
  z.object({ op: z.literal("discard-concern"), id: z.string().max(64) }),        // human; raiser may discard own open concern
  z.object({ op: z.literal("decide"), id: z.string().max(64),
             status: z.enum(["accepted", "rejected"]), note: z.string().max(4_000) }), // human only
  z.object({ op: z.literal("dispatch-revision"), id: z.string().max(64),
             concernIds: z.array(z.string().max(64)).min(1).max(50),
             instruction: z.string().max(16_000), agentId: z.string().max(64) }), // human only
  z.object({ op: z.literal("revision-progress"), id: z.string().max(64),
             note: z.string().max(500) }),                                        // agent only (its own revision)
  z.object({ op: z.literal("revision-result"), id: z.string().max(64),
             result: revisionSchema.shape.result.unwrap() }),                     // agent only ⇒ linked concerns → resolved
  z.object({ op: z.literal("revision-failed"), id: z.string().max(64), error: z.string().max(1_000) }),
  z.object({ op: z.literal("verify"), id: z.string().max(64),
             ok: z.boolean(), note: z.string().max(4_000).optional() }),          // human only; ok=false reopens → accepted
])

/** POST body to the bridge — the actor is stamped by the trusted caller (web route / worker). */
export const reviewOpEnvelopeSchema = z.object({
  actor: reviewActorSchema,
  op: reviewOpSchema,
})
```

### 1.4 Data-channel notifications (`packages/shared/src/index.ts`)

Add `Review: "review"` to `DataTopic`, plus:

```ts
export const reviewSyncMessageSchema = z.discriminatedUnion("type", [
  // "state changed, refetch if rev > yours" — tiny, always under the 15KB cap.
  z.object({ type: z.literal("review-sync"), rev: z.number().int().min(0),
             opKind: z.string().max(32).optional(),      // toast/targeting hint
             revisionId: z.string().max(64).optional(),
             agentId: z.string().max(64).optional() }),
  // presenter navigation: "everyone look here"
  z.object({ type: z.literal("review-focus"), path: z.string().max(1024),
             line: z.number().int().positive().optional(),
             side: z.enum(["old", "new"]).optional(), at: z.number() }),
])
```

Also add optional `participantsCanResolveReviews: z.boolean().default(true)` to
`roomSettingsSchema` (additive-optional; old clients parse fine).

## 2. Bridge review store

**New `apps/agent-bridge/src/review-store.ts`**, mounted in `index.ts`, mirroring
the doc/canvas store (memory + same TTL sweep + room-count cap). Entry shape:
`{ updatedAt, rev, snapshots: Map<sha, PrSnapshot> (≤2), concerns, revisions }`.

Routes (behind the existing `BRIDGE_TOKEN` bearer middleware):

- `GET /rooms/:room/review` → `reviewStateSchema` (patches stripped).
- `GET /rooms/:room/review/pr?sha=<headSha>` → full snapshot with patches (current
  or previous sha only; 404 otherwise).
- `POST /rooms/:room/review/ops` → body `reviewOpEnvelopeSchema`; applies with
  actor-kind authorization (§5), bumps `rev`, returns `{ ok, rev }`. Rejections
  return 403 with a reason string (surfaced to the brain as a tool-result-style
  error, like canvas op validation errors).

Store side effects: `revision-result` marks the revision `done` and linked concerns
`resolved` (with resolution notes/new anchors); `verify {ok:false}` reopens to
`accepted`; at most **one active revision per agent** (dispatch while one is
`working` is rejected — the TTY client serializes turns anyway).

## 3. Web proxy routes (the human path)

- `apps/web/src/app/api/rooms/[slug]/review/route.ts` — GET state. Clone
  `doc/route.ts` authorization verbatim (`verifyParticipant` + `isKicked`, humans only).
- `apps/web/src/app/api/rooms/[slug]/review/pr/route.ts` — GET snapshot by sha.
- `apps/web/src/app/api/rooms/[slug]/review/ops/route.ts` — POST. Parses
  `reviewOpSchema` only (**no envelope from the client**), stamps
  `actor: { identity, name, kind: "human" }` from the verified LiveKit token,
  rejects agent-only ops (`push-snapshot`, `revision-*`) outright, checks the
  host-reservation setting for `decide`/`dispatch-revision`/`verify` (room metadata
  via `RoomServiceClient`, `control-auth.ts` semantics:
  `participantsCanResolveReviews || sender === hostIdentity`, failing closed on
  unparseable metadata), then forwards the envelope to the bridge. After a 200 the
  *client* broadcasts `review-sync` (it's in the room; the route isn't).

## 4. UI

### Placement — both, like the doc

- `$reviewOnStage` atom in `stores/panels.ts`, mutually exclusive with `$docOnStage`
  and `$canvasOpen` (extend the cross-clearing in `togglePanel`/`openWhiteboard`).
- New `Panel` variant `"review"` + `ReviewPanel` in `PanelHost.tsx` titles/switch,
  with the doc's "Open on stage" maximize affordance.
- `MeetingView.tsx`: render `ReviewTakeover` first in the takeover chain, passing
  `tracks`/`focused` like `DocTakeover` so the participant strip survives.
- `ControlBar.tsx`: a `GitPullRequest` (lucide) button + overflow entry, badge =
  open-concern count; hidden until a snapshot exists (empty state teaches the flow, §6).

### Diff rendering — `@pierre/diffs`

Verified: Apache-2.0, peers react ^18.3.1 || ^19, deps shiki ^3||^4 + `diff` 9.
Provides `File`/`FileDiff` components, split (side-by-side) and stacked (unified)
layouts, line click/drag/shift-click selection, and an annotation framework for
injecting content at lines — a direct fit for concern threads.

Integration:
- One `FileDiff` per file, fed the per-file unified patch from `reviewFileSchema.patch`.
- Concerns render through the annotation API at their anchor line: compact chip
  (raiser avatar + status color) expanding to a `ConcernThread` (body, decision,
  resolution note, verify buttons).
- Line-click / range-select opens `NewConcernPopover` → `raise-concern` op with the
  anchor (`sha` = current `headSha`).
- Stacked (unified) default; split toggle in the stage header.

Gaps we cover ourselves:
1. **File tree** — build `ReviewFileTree` (daisyUI menu, collapsed folders,
   per-file ±counts and concern dots).
2. **Virtualization** — accordion: only the selected file's `FileDiff` mounts
   (IntersectionObserver prefetch of neighbors); files over `MAX_PATCH_CHARS`
   arrive truncated with a "view on GitHub" link. Bounds shiki work too.
3. **Bundle size** — shiki is heavy. The entire review surface loads via
   `next/dynamic(() => import(...), { ssr: false })` — the exact Excalidraw pattern
   in `WhiteboardCanvas.tsx`. Constrain the language set / lazy grammars if the
   library exposes shiki config.
4. **Input format** — docs don't state whether `FileDiff` takes a patch string or
   before/after contents. **Spike task #1** verifies; if it wants structured hunks,
   parse our patch with the `diff` package it already depends on. The schema is
   format-proof (unified patch is the interchange).

### Navigation sync

Presenter clicks a file/line with "Bring everyone along" enabled → broadcast
`review-focus` on `DataTopic.Review` (reliable). Receivers with "Follow" on
(default on) open the stage and scroll to the anchor. Last focus wins; `at` breaks ties.

### Component/file breakdown

```
apps/web/src/stores/review.ts            // $review, $reviewSnapshots (by sha), $reviewFocus,
                                         // $followReview, postReviewOp(), fetchReviewState(), fetchSnapshot(sha)
apps/web/src/components/room/review/
  ReviewTakeover.tsx                     // stage shell (dynamic import boundary); header: PR title/repo/#,
                                         // checks badge, headRef@sha, commit count, split + follow toggles
  ReviewFileTree.tsx
  ReviewDiffFile.tsx                     // FileDiff wrapper + annotations + line-select → concern
  ConcernThread.tsx                      // shared by stage annotations and panel
  NewConcernPopover.tsx
apps/web/src/components/room/panels/ReviewPanel.tsx
                                         // ledger: Open / Accepted / In revision / Resolved / Verified / Rejected;
                                         // decide buttons; multi-select accepted → "Send to <agent>" compose sheet;
                                         // revision timeline; verify ✓/✗; "Post summary to GitHub"
```

`RoomDataListener.tsx` additions: subscribe `DataTopic.Review` →
(a) `review-sync`: refetch state when `rev` is newer (debounced 300 ms); toasts
("New revision pushed — diff updated" on `push-snapshot`, "Agent finished revision"
on `revision-result`); (b) `review-focus` → `$reviewFocus`. Plus fetch-on-join +
`Reconnected` refetch, copied from the doc snapshot effect.

## 5. Roles & safety

Authorization enforced **in the store's op applier** (defense in depth: the web
route pre-filters; the worker only ever stamps `kind:"agent"`):

| Op | Human (admitted) | Agent | Notes |
|---|---|---|---|
| push-snapshot | ✗ | ✓ | |
| raise-concern | ✓ | ✓ forced `proposed:true` | |
| adopt/discard-concern | ✓ (discard: raiser or decider-class) | ✗ | |
| decide (accept/reject) | ✓ * | ✗ | agents propose, humans dispose |
| dispatch-revision | ✓ * | ✗ | |
| revision-progress/result/failed | ✗ | ✓ own revision (`agentId` match) | |
| verify | ✓ * | ✗ | human eyes close the loop |

`*` = subject to `participantsCanResolveReviews` (default **true**); when the host
turns it off, only `hostIdentity` may decide/dispatch/verify. Raising concerns is
never host-reserved — capturing worries is everyone's job.

Web participants have full human powers; they simply can't host the agent.

**Agent owner leaves / desktop closes:** the worker stays in the room but its brain
socket dies. In-flight turns throw → worker posts `revision-failed "agent disconnected"`.
The review state, diff, and ledger remain fully readable/decidable (bridge store);
the panel shows "authoring agent offline — reconnect to dispatch revisions" keyed
off the agent participant's presence. Failed revisions get a Retry button (a new
`dispatch-revision` with the same concerns).

## 6. Closed-loop flow (exact sequence)

Legend: `[web]` browser · `[route]` Next API route · `[store]` bridge review store ·
`[worker]` bridge agent worker · `[brain]` local authoring agent over TTY ·
`[DC]` LiveKit data channel.

1. **Load PR.** Human (voice or chat): "load PR 123". `[brain]` runs
   `gh pr view/diff` locally, replies with
   `<<<REVIEW {"op":"push-snapshot","snapshot":{…}} REVIEW>>>`. `[worker]` (new
   `review-blocks.ts` extractor on the shared brain-reply path) validates against
   `prSnapshotSchema`, POSTs the envelope (`actor kind:"agent"`) to `[store]`,
   broadcasts `review-sync {rev, opKind:"push-snapshot"}` on `[DC]`. Every `[web]`
   fetches state; the stage opens (toast → click, auto for the requester).
2. **Interrogate.** Humans navigate; presenter uses `review-focus`. The brain
   answers "why did you do X?" through the normal conversation path —
   `meeting-context.ts` gains a review section ("PR #123 `owner/repo` under review;
   N open concerns: …") so every turn is review-aware.
3. **Raise concern.** Human selects lines → `NewConcernPopover` → `[route]` POST
   `raise-concern` → `[store]` → `[web]` broadcasts `review-sync`. Voice capture:
   "flag that as a concern" → brain emits
   `<<<REVIEW {"op":"raise-concern","proposed":true,…} REVIEW>>>` → lands as a
   **proposed** concern a human adopts or discards in the panel.
4. **Decide.** Human clicks Accept/Reject with a note → `decide` op.
5. **Compose & dispatch.** Human multi-selects accepted concerns → compose sheet
   (prefilled with concern bodies + anchors) → `dispatch-revision` op → `[web]`
   broadcasts `review-sync {opKind:"dispatch-revision", revisionId, agentId}`.
6. **Worker picks it up.** `[worker]` adds `DataTopic.Review` to its `onData`
   switch: on a dispatch naming its `agentId`, it GETs the revision from `[store]`,
   posts `revision-progress "started"`, and runs a brain turn:

   ```
   [revision-request <id>] You are asked to revise PR #123 on branch <headRef>.
   Address these agreed concerns, commit to the branch, and push:
   1. (<path>:<line>) <body> — decision note: <note>
   ...
   When done, reply with a <<<REVIEW revision-result REVIEW>>> block mapping each
   concern to what you changed, then a <<<REVIEW push-snapshot REVIEW>>> block
   with the refreshed PR.
   ```

   No new frame types on the brain protocol — it's a normal turn; a dedicated
   frame could replace the text envelope later without changing anything else.
7. **Agent works.** Brain `tool_call`/`tool_result` frames already stream to the
   room as `agent-activity` events. The worker posts coarse `revision-progress` ops
   on step milestones so the panel timeline works without the activity feed open.
8. **Result.** Brain replies with `revision-result` (summary, commits, per-concern
   mapping, new `headSha`) + a fresh `push-snapshot`. Worker validates, POSTs both,
   broadcasts. Concerns anchored to the old sha and not remapped are flagged stale
   in the UI (`anchor.sha ≠ headSha`). Brain error/disconnect → `revision-failed`.
9. **Verify.** Human opens each resolved concern (panel deep-links to the new diff
   at `resolution.newAnchor ?? anchor`), clicks Verify ✓ (→ `verified`) or ✗ with a
   note (→ back to `accepted`, ready for another round).
10. **Summarize & merge.** "Post summary to GitHub" composes a markdown summary
    from the ledger (concern → decision → resolution → verified-by) and dispatches
    it as a brain turn ("post this as a PR review/comment via gh"). The human
    merges — via the agent or the GitHub UI. Merge stays human-initiated in v1.

**Agent-facing surface summary:** everything the brain does goes through
`<<<REVIEW … REVIEW>>>` blocks (`push-snapshot`, `raise-concern` (proposed),
`revision-result`, transient `pr-list` for the picker). One protocol note
(`REVIEW_PROTOCOL_NOTE` in `review-blocks.ts`) joins the meeting context beside
`DOC_PROTOCOL_NOTE`. Native realtime tools (`read_review`) are deferred — realtime
models reach the brain via `do_task` and the brain sees review state in context.

## 7. Persistence: bridge store now, Postgres later

**V1: bridge room store.** Matches the ephemeral `/r/<slug>` room model (no
meetings table exists), zero migration risk, identical ops story to doc/canvas.
The durable artifact is the GitHub review summary + the pushed commits.

Accepted v1 limitations (state in release notes): bridge restart or TTL loses the
in-room ledger; review history isn't queryable server-side. A review spanning
multiple meetings works by re-loading: the agent re-pushes the snapshot next
meeting and can re-import unresolved concerns from the posted GitHub summary
(explicit `import-concerns` op deferred).

**Phase-2 schema sketch** (designed, not built) for `packages/db/src/schema.ts`:

```ts
reviews:          { id uuid pk, repo text, prNumber int, title, lastHeadSha,
                    createdBy uuid→users, createdAt, closedAt, unique(repo, prNumber) }
reviewSessions:   { reviewId fk, roomName text, startedAt }        // one review, many meetings
reviewConcerns:   { id uuid pk, reviewId fk, anchor jsonb, body, status,
                    raisedByUserId?/raisedByAgentId?, decision jsonb, resolution jsonb,
                    verifiedByUserId?, createdAt, index(reviewId, status) }
reviewRevisions:  { id uuid pk, reviewId fk, agentId, instruction, status,
                    result jsonb, createdAt }
```

The op vocabulary and entity ids are already row-shaped; migration = bridge store
becomes a write-through cache, web routes write Postgres, `GET /review` reads it.
The wire protocol doesn't change.

## 8. Start flow

1. Review button (empty state): "Bring in a PR — connect your coding agent" →
   deep-links the agent connect flow (workstream 01's AgentsPanel section).
2. With an agent present: "Ask <agent> for open PRs" → worker requests a
   `<<<REVIEW {"op":"pr-list","prs":[…]} REVIEW>>>` block (transient — rendered as
   a picker, not stored) → click a PR → worker dispatches "load PR #N" → snapshot lands.
3. Fallback that always works: ask the agent by voice/chat.

## 9. Touched files

New:
- `packages/shared/src/review.ts` (+ `review.test.ts`)
- `apps/agent-bridge/src/review-store.ts` (+ tests)
- `apps/agent-bridge/src/review-blocks.ts`
- `apps/web/src/app/api/rooms/[slug]/review/{route.ts, pr/route.ts, ops/route.ts}`
- `apps/web/src/stores/review.ts`
- `apps/web/src/components/room/review/{ReviewTakeover,ReviewFileTree,ReviewDiffFile,ConcernThread,NewConcernPopover}.tsx`
- `apps/web/src/components/room/panels/ReviewPanel.tsx`

Modified:
- `packages/shared/src/index.ts` (DataTopic.Review, `reviewSyncMessageSchema`, `participantsCanResolveReviews`)
- `packages/shared/package.json` (subpath export)
- `apps/agent-bridge/src/index.ts` (mount store)
- `apps/agent-bridge/src/worker.ts` (block extraction, Review topic in onData, revision turns)
- `apps/agent-bridge/src/meeting-context.ts` (review section + protocol note)
- `apps/web/src/stores/panels.ts`, `MeetingView.tsx`, `ControlBar.tsx`, `PanelHost.tsx`, `RoomDataListener.tsx`
- `apps/web/package.json` (`@pierre/diffs`)

## 10. Risks & open questions

1. **`@pierre/diffs` API assumptions** (biggest unknown): diff input format,
   annotation extension points, shiki configurability, SSR behavior, shadow-DOM
   theming vs daisyUI tokens. The spike gates the UI phase; fallback (only on a
   concrete blocker): render unified diffs ourselves — the library is a leaf; all
   schemas/routes survive.
2. **Bundle size**: shiki + diffs stay out of the room's critical path via the
   dynamic-import boundary; add a bundle check to the PR.
3. **Huge PRs**: the 500-file/4 MB caps are guesses; tune against real
   agent-authored PRs. Accordion-mount bounds the DOM regardless.
4. **Marker-block JSON fragility**: malformed JSON must return a legible error to
   the brain's next turn (mirror `canvas-blocks.ts`), never a silent drop.
5. **Concurrent ops**: single-writer store + per-op validation makes races benign
   (last valid op wins; `rev` monotonicity means clients never regress). No CRDT
   needed — entities are keyed, ops are field-scoped.
6. **State loss on bridge restart** mid-review: acceptable v1 (agent re-pushes;
   GitHub summary is durable); Postgres phase 2 removes it.
7. **Open questions**: require verifier ≠ raiser? (recommend no for v1 — small
   teams). One active revision per agent enforced in-store? (recommend yes — done, §2).
