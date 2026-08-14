# Whiteboard multiplayer repro checklist

Issue #207 reports, verbatim: "We're still having some issues when multiple
people try to work on the whiteboard at the same time." No repro steps, no
date, no screenshots. An investigation of the sync path
(`apps/web/src/components/room/WhiteboardCanvas.tsx`,
`apps/web/src/components/room/RoomDataListener.tsx`,
`apps/web/src/stores/canvas.ts`, `apps/agent-bridge/src/worker.ts`,
`apps/agent-bridge/src/canvas-records.ts`) found no confirmed regression:
every documented hazard in `WhiteboardCanvas.tsx` (mounted-version guard,
tombstone guard, pre-rebuild local-edit capture) traces to a working,
already-tested mitigation, and the one concrete race the investigation could
construct a mechanism for — the agent-bridge computing LWW clocks off a
stale, throttled snapshot — was already fixed in `1bb246d`.

This checklist exists to find out what, if anything, still reproduces before
committing to further code changes. Run it with **two browser tabs/windows**
against the local dev stack (`pnpm dev`), joined to the same room, each as a
distinct participant. Where a scenario needs an agent, use whatever agent
join path this deployment already supports (voice or chat-triggered).

For each scenario: perform the steps, then check the named observable on
**both** tabs. Record pass/fail and any console warnings. A "pass" for the
same-shape collision scenario (1) means the *documented* lossy behavior is
what happens — not that both edits survive; LWW is a deliberate tradeoff
(comment at `packages/shared/src/index.ts:771-778`), not a bug.

## Background: what "sync" means here

Sync is a custom per-element last-write-wins (LWW) scheme over LiveKit's
reliable data channel (`DataTopic.Canvas`). Each element is a `CanvasRecord
{id, record, v, at, by}`; `mergeCanvasRecord` picks a winner by clock `v`,
then wall-clock `at`, then `by`. Edits to *different* shapes never conflict.
Edits to the *same* shape in the same short window always cost one of them —
there is no merge, no CRDT, and (before this fix) no user-visible signal that
an edit was dropped.

## Scenario 1 — Same-shape collision (two humans)

Confirms the documented, accepted tradeoff. Expected to be lossy — this is
not a bug to fix, just a behavior to confirm and be able to name precisely
if this issue gets closed as working-as-designed.

1. Both tabs select the same existing shape (or draw one, let it settle,
   then both select it).
2. At roughly the same moment, tab A drags the shape to a new position while
   tab B changes its fill color.
3. **Observable:** does the shape converge to an *identical* final state on
   both tabs within ~1 second (no perpetual mismatch, no flicker loop)? It's
   expected that only one of the two edits (the move *or* the color change)
   survives — check which one, and confirm both tabs agree on the same
   winner. A **fail** here is: the two tabs disagree on the final state
   (diverged, not just lossy), or the shape flickers/reverts repeatedly
   instead of settling.
4. Repeat 2-3 several times in a tight loop (rapid alternating edits) to
   check for the rebuild-loop failure mode `4363bb0` fixed (only the first
   drawer's edits ever landing).

## Scenario 2 — Human + agent overlap mid-reveal

Checks the specific race the investigation traced through
`onSceneChange`'s pre-rebuild local-edit capture (`WhiteboardCanvas.tsx`,
the block right before `updateScene` in the remote-flush handler) and the
agent-bridge's live cache fold (`worker.ts`, `mergeIntoCanvasCache`).

1. Ask the agent (voice or chat) to draw or resize a shape — something with
   a visible multi-step reveal if the agent streams strokes.
2. While the agent's reveal is still in progress, from the human tab, drag
   or delete a *different* shape that is not the one the agent is touching.
3. **Observable:** does the human's edit land and persist (not get silently
   reverted when the agent's reveal completes)? Does the agent's shape also
   complete correctly? Check the browser console on the human tab for
   `"whiteboard: scene update failed"` — that would indicate the guard logic
   hit an unexpected element shape.
4. Repeat with the human editing the *same* shape the agent is mid-reveal on
   (recoloring it while the agent resizes it) — this is expected to be lossy
   per scenario 1's logic (same-shape collision), but confirm it fails the
   same clean way (one edit wins, no divergence) rather than corrupting the
   element (e.g. NaN dimensions, missing points).

## Scenario 3 — Late joiner after a burst of edits

Checks whether a participant who joins *after* a flurry of edits sees the
same board as everyone already there — the scenario the `putSnapshot`
hardening in this same change targets.

1. With two tabs already in the room, generate a burst of edits: draw
   several shapes, move them, delete one, recolor another, across both
   tabs, over a few seconds.
2. Wait at least 4 seconds (past `SNAPSHOT_THROTTLE_MS` = 3000ms) so the
   durable snapshot PUT has had a chance to fire.
3. Open a **third** tab/window as a new participant joining the room fresh
   (or reload one of the two existing tabs — a reload re-fetches the
   snapshot via `GET`, exercising the same durable-store path a genuine late
   joiner uses).
4. **Observable:** does the newly joined/reloaded tab's board exactly match
   the two live tabs (same shapes, same positions, same colors, same
   deletions)? A **fail** is any shape present/absent/stale that isn't on
   the live tabs. Check the Network tab for the `PUT
   /api/rooms/{slug}/canvas` calls during step 1 — did they all return 2xx?
   Check the console for the new `"whiteboard: snapshot PUT ... will retry
   on next scheduled tick"` warning (added by this change) — it should
   *not* appear in a healthy run; if it does, note what triggered it.

## Scenario 4 — Reconnect mid-edit

Checks recovery after a network interruption on one client while the other
keeps editing.

1. Both tabs in the room, both idle-watching the board.
2. On tab A, use devtools (Network conditions → Offline, or toggle Wi-Fi/
   airplane mode if testing on a real device) to drop its connection.
3. While tab A is offline, make several edits on tab B: move shapes, add
   new ones, delete one.
4. Restore tab A's connection.
5. **Observable:** does tab A catch up to tab B's board within a few
   seconds of reconnecting (LiveKit reconnect + a fresh snapshot fetch), or
   does it stay stuck on stale state? Does tab A's *own* pre-disconnect
   edits (if any were made just before going offline) survive, get
   silently dropped, or get incorrectly reapplied on top of B's newer
   state? Check both tabs' consoles for reconnect-related warnings or
   errors.

## Scenario 5 — Stress / silent-PUT-failure check

Targets the concrete gap this change hardens: a snapshot PUT that fails
(network blip, or the payload exceeding `MAX_CANVAS_BYTES`) previously went
silently quiet until the *next local edit* re-armed it — meaning a late
joiner in that window got a stale board with zero indication anything was
wrong.

1. On both tabs, draw many freehand strokes rapidly and continuously for
   10-15 seconds (freehand strokes are the densest element type — most
   likely to push a snapshot body toward `MAX_CANVAS_BYTES`, and their
   points get thinned for the *broadcast* wire format but not for the
   snapshot PUT body).
2. Watch the Network tab on both clients for `PUT /api/rooms/{slug}/canvas`
   calls throughout. Note any non-2xx response (413, 5xx) or failed
   request.
3. **Observable:** if a PUT does fail, does the console show the new
   `"whiteboard: snapshot PUT rejected, will retry on next scheduled tick"`
   / `"...PUT failed, will retry..."` warning, and does a subsequent PUT
   (within one more `SNAPSHOT_THROTTLE_MS` tick after the *next* local
   edit) succeed and bring the durable store back in sync? Confirm by
   opening a fresh third tab after the stress burst settles and checking it
   matches (same check as scenario 3).
4. If no PUT failure naturally occurs, this scenario can be considered
   inconclusive rather than a pass/fail — it's exercising a rare/edge
   condition, not a guaranteed reproduction. Note whether the stress load
   was heavy enough to plausibly approach `MAX_CANVAS_BYTES`; if not, this
   step should be repeated with an even heavier stroke burst before ruling
   it out.

## Recording results

For each scenario, capture: pass/fail/inconclusive, exact steps that
diverged from the script (automation timing is tight — `BROADCAST_THROTTLE_MS`
= 120ms, the remote-flush debounce = 30ms — and may need to be re-run
manually by a human driving one tab if automated clicks/drags can't land the
timing), and any console warnings or errors seen on either tab. If only
scenario 1's documented same-shape-collision behavior reproduces and
everything else passes cleanly, the honest conclusion is that #207 describes
the accepted LWW tradeoff (or a symptom already fixed by a prior commit) —
not an open regression — and the issue should be closed with that
explanation rather than met with further speculative code changes.
