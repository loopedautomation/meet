/**
 * Tier-2 injector: push a fixture into a LIVE room's whiteboard through the
 * bridge's canvas store — no LLM anywhere. Translates ops with the real
 * buildCanvasRecords against the room's current snapshot, then POSTs the
 * diff to the bridge control API.
 *
 *   BRIDGE_TOKEN=... pnpm exec tsx harness/inject.ts <room-slug> <fixture-name>
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type CanvasRecord,
  canvasOpBatchSchema,
  canvasSnapshotSchema,
} from "@meet/shared"
import { buildCanvasRecords } from "../src/canvas-records.js"

const [room, fixtureName] = process.argv.slice(2)
const token = process.env.BRIDGE_TOKEN
const base = process.env.BRIDGE_URL ?? "http://localhost:8090"
if (!room || !fixtureName || !token) {
  console.error(
    "usage: BRIDGE_TOKEN=... tsx harness/inject.ts <room-slug> <fixture>",
  )
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures", `${fixtureName}.json`), "utf8"),
) as { steps?: unknown[]; ops?: unknown }

const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
}

const snapshotRes = await fetch(`${base}/rooms/${room}/canvas`, { headers })
const snapshot = canvasSnapshotSchema.parse(await snapshotRes.json())
const board = new Map<string, CanvasRecord>(
  snapshot.records.map((r) => [r.id, r]),
)

for (const raw of fixture.steps ?? [fixture.ops]) {
  const ops = canvasOpBatchSchema.parse(raw)
  const built = buildCanvasRecords(ops, board, {
    identity: "agent-harness",
    name: "Harness",
  })
  for (const change of built.changes) board.set(change.id, change)
  const res = await fetch(`${base}/rooms/${room}/canvas/diff`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "diff",
      from: "agent-harness",
      fromName: "Harness",
      changes: built.changes,
    }),
  })
  console.log(`step: ${built.summary} → HTTP ${res.status}`)
  for (const w of built.warnings) console.log(`  ⚠ ${w}`)
}
