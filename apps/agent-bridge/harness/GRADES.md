# Drawing quality grades

Rubric per fixture, 1–5 each (5 = excellent): **P**lacement, **A**rrows,
**L**abels, **S**pacing, **E**rror/warning quality. Re-graded every cycle;
history kept so regressions are visible.

## Cycle 0 — baseline (before any fixes)

| Fixture | P | A | L | S | E | Notes |
|---|---|---|---|---|---|---|
| 01-flowchart-ops | 1 | 1 | 1 | 2 | - | All 4 boxes in one row; api→auth and api→db arrows strike straight through intervening boxes; arrow labels overlap shape labels; arrows attach center-to-center, not edges. |
| 02-architecture-mixed | 1 | 1 | 2 | 1 | - | Everything at y=0 in one strip; title stranded far left of shapes; sticky note pushed past x=1287 (off view); arrows through boxes again. |
| 03-mermaid-pipeline | 4 | 2 | 4 | 3 | - | Dagre ranks fine, but arrows run center-to-center: heads land *inside* boxes; vertical rank gap generous. |
| 04-mermaid-cycle | 3 | 2 | 2 | 3 | - | Cycle routes around, but nodes staggered off one rank; forward arrows strike through Screenshot/Grade labels. |
| 05-columns | 4 | - | 4 | 3 | - | Explicit coords respected. Sticky notes auto-size much wider than expected: pros/cons columns visually collide at the seam. |
| 06-timeline | 4 | 2 | 2 | 4 | - | Boxes placed as authored, but q1→q2→q3 arrows strike through box labels; waypointed "ship" arrow renders fine. |
| 07-incremental | 2 | 1 | 2 | - | - | Worst case: after `move`, bound arrows do NOT follow (Gamma orphaned bottom-right, its arrow still pointing at the old spot); after `delete` of Alpha its arrow lingers; updated label garbled under overlapping arrows. |
| 08-diagram-redraw | 4 | 3 | 4 | 4 | - | Redraw-in-place works (no duplicates, position stable). Arrowheads dip slightly inside target boxes. |
| 09-freehand | 4 | - | 4 | 4 | - | Freehand polyline fine. |
| 10-dense-graph | 1 | 1 | 1 | 1 | - | 10 boxes in one 2000px-wide row at y=0; every arrow horizontal through neighbors. The row-wrap placer's worst case. |
| 90-single-object | - | - | - | - | 3 | Error says "expected array, received object" — accurate but should just accept a single object (auto-wrap). |
| 91-trailing-comma | - | - | - | - | 2 | "wasn't valid JSON" — no hint where or what to fix. |
| 92-bad-enum | - | - | - | - | 4 | Lists the full palette — actionable. Could suggest nearest color. |
| 93-missing-ref | - | - | - | - | 4 | Warning names the missing id; rest of batch still drawn. |
| 94-bad-mermaid | - | - | - | - | 4 | Says what IS supported. |
| 95-oversize | - | - | - | - | 3 | States the 50 cap; could suggest splitting into two batches. |

### Cycle 0 → fix priorities
1. **Arrows attach to shape edges, not centers** — wrecks every connected drawing (01, 02, 03, 04, 06, 08, 10).
2. **Graph-aware auto-placement**: when a coordinate-free batch contains arrows, lay the batch out with dagre (already used by expandDiagram) instead of one giant row (01, 02, 10).
3. **`move` must re-route bound arrows; `delete` must drop dangling arrows** (07).
4. Lenient parsing: auto-wrap single op object (90); point at the JSON error location (91).
5. Sticky-note default width smaller / respect coords column layouts (05).

## Cycle 1 — edge anchors, graph placement, arrow maintenance

Changes: arrows anchor at shape edges (+6px gap) with waypoint-aware aim;
coordinate-free batches containing arrows lay out via dagre (TB) as one
block; `move`/resize re-route bound arrows; `delete` removes arrows
touching the deleted shape.

| Fixture | P | A | L | S | Notes |
|---|---|---|---|---|---|
| 01-flowchart-ops | 5 | 4 | 5 | 4 | Proper TB flowchart; labels sit clear between ranks. |
| 10-dense-graph | 4 | 4 | 5 | 4 | Real graph layout; long chain could prefer 2 columns (minor). |

Remaining (cycle 2 targets): verify 07 move/delete visually; 02 mixed batch
(title/note placement relative to graph block); lenient parsing for 90/91;
sticky-note default width (05).
