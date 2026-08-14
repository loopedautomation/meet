import { describe, expect, it, vi } from "vitest"

// WhiteboardCanvas.tsx pulls in @excalidraw/excalidraw (and its roughjs
// dependency, whose subpath import Vite's strict ESM resolver can't follow)
// purely as a module-load side effect of the file's top-level imports. The
// seam under test — shouldRetrySnapshotPut — never touches Excalidraw, so
// stub the package out rather than let an unrelated resolution failure
// block a test of pure retry-decision logic.
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: () => null,
  CaptureUpdateAction: { NEVER: "NEVER" },
  restoreElements: (els: unknown) => els,
}))
vi.mock("@excalidraw/excalidraw/index.css", () => ({}))

const { shouldRetrySnapshotPut } = await import("./WhiteboardCanvas")

// putSnapshot's durable snapshot PUT has no automatic timer of its own — it
// only fires again when a local edit re-arms `snapshotDirty`. If a PUT fails
// silently, the store can go stale until someone happens to edit again, and
// a late joiner in that window sees an incomplete board with no indication
// anything is wrong. shouldRetrySnapshotPut is the pure decision behind the
// fix: any failure (network rejection or non-OK response) must re-arm the
// retry; only a clean success should not.
describe("shouldRetrySnapshotPut", () => {
  it("retries after a network failure (fetch rejection)", () => {
    expect(shouldRetrySnapshotPut(new Error("network down"))).toBe(true)
  })

  it("retries after a non-OK response (e.g. 413 over MAX_CANVAS_BYTES, or a 5xx)", () => {
    expect(shouldRetrySnapshotPut({ ok: false, status: 413 })).toBe(true)
  })

  it("does not retry after a clean 200 OK", () => {
    expect(shouldRetrySnapshotPut({ ok: true, status: 200 })).toBe(false)
  })
})
