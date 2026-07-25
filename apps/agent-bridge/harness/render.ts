/**
 * Offline drawing harness: runs the fixture corpus through the exact
 * production pipeline (parseCanvasBlock → buildCanvasRecords, with the
 * dagre expandDiagram fallback for mermaid) and writes each result as an
 * .excalidraw scene plus a results.json of summaries/warnings/errors.
 *
 * No LLM anywhere: fixtures stand in for model output. Run with
 *   pnpm exec tsx harness/render.ts
 * from apps/agent-bridge, then view scenes with harness/viewer.html.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type CanvasRecord, canvasOpBatchSchema } from "@meet/shared"
import { parseCanvasBlock } from "../src/canvas-blocks.js"
import { buildCanvasRecords } from "../src/canvas-records.js"

type Fixture = {
  name?: string
  note?: string
  /** Sequential op batches — later steps see earlier steps' board. */
  steps?: unknown[]
  /** Single op batch (shorthand for one step). */
  ops?: unknown
  /** Raw marker-block payload, fed to parseCanvasBlock (parser tests). */
  block?: string
}

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(here, "fixtures")
const outDir = join(here, "out")
mkdirSync(outDir, { recursive: true })

const author = { identity: "agent-harness", name: "Harness" }

type FixtureResult = {
  fixture: string
  note?: string
  steps: {
    summary?: string
    warnings: string[]
    error?: string
  }[]
  elements: number
}

const results: FixtureResult[] = []

const sceneFor = (records: Map<string, CanvasRecord>) => ({
  type: "excalidraw",
  version: 2,
  source: "drawing-harness",
  elements: [...records.values()]
    .map((r) => r.record)
    .filter((r): r is Record<string, unknown> => r !== null),
  appState: { viewBackgroundColor: "#ffffff" },
})

for (const file of readdirSync(fixturesDir).sort()) {
  if (!file.endsWith(".json")) continue
  const fixture = JSON.parse(
    readFileSync(join(fixturesDir, file), "utf8"),
  ) as Fixture
  const name = fixture.name ?? file.replace(/\.json$/, "")
  const result: FixtureResult = {
    fixture: name,
    note: fixture.note,
    steps: [],
    elements: 0,
  }

  // The board accumulates across steps, exactly as a room's canvas would.
  let board = new Map<string, CanvasRecord>()

  const batches: { raw?: unknown; block?: string }[] = fixture.block
    ? [{ block: fixture.block }]
    : (fixture.steps ?? [fixture.ops]).map((raw) => ({ raw }))

  for (const batch of batches) {
    let ops: unknown
    if (batch.block !== undefined) {
      const parsed = parseCanvasBlock(batch.block)
      if ("error" in parsed) {
        result.steps.push({ warnings: [], error: parsed.error })
        continue
      }
      ops = parsed.ops
    } else {
      const parsed = canvasOpBatchSchema.safeParse(batch.raw)
      if (!parsed.success) {
        result.steps.push({
          warnings: [],
          error: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        })
        continue
      }
      ops = parsed.data
    }
    // biome-ignore lint/suspicious/noExplicitAny: validated just above
    const built = buildCanvasRecords(ops as any, board, author)
    for (const change of built.changes) {
      board.set(change.id, change)
      // Deletions are records with null payloads; keep them so LWW state
      // stays realistic, but they drop out of the scene naturally.
    }
    result.steps.push({ summary: built.summary, warnings: built.warnings })
  }

  board = new Map([...board].filter(([, r]) => r.record !== null))
  result.elements = board.size
  writeFileSync(
    join(outDir, `${name}.excalidraw`),
    JSON.stringify(sceneFor(board), null, 2),
  )
  results.push(result)
  console.log(
    `${name}: ${result.elements} elements, ` +
      `${result.steps.flatMap((s) => s.warnings).length} warnings` +
      (result.steps.some((s) => s.error) ? ", ERROR" : ""),
  )
}

writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2))
writeFileSync(
  join(outDir, "index.json"),
  JSON.stringify(
    results.map((r) => r.fixture),
    null,
    2,
  ),
)
console.log(`\n${results.length} fixtures rendered into harness/out/`)
