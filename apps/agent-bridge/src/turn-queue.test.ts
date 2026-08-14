// A generic FIFO turn queue: prompts submitted while a turn is running queue
// in submission order and run one at a time, automatically, with per-item
// resolve/reject and change notification for the UI (the waiting list, not
// the in-flight item). Extracted out of worker.ts's per-agent closure so
// these correctness properties are testable without the LiveKit job-context
// glue around them (see the plan in .orchestrator/plans/276.md).
import { describe, expect, it, vi } from "vitest"
import { createTurnQueue } from "./turn-queue.js"

/** A run() that resolves on demand, so tests control exactly when a turn ends. */
function deferredRun<TItem, TResult>() {
  const pending: {
    item: TItem
    resolve: (result: TResult) => void
    reject: (err: unknown) => void
  }[] = []
  const run = (item: TItem) =>
    new Promise<TResult>((resolve, reject) => {
      pending.push({ item, resolve, reject })
    })
  return { run, pending }
}

describe("createTurnQueue", () => {
  it("runs a single enqueued item and resolves with its result", async () => {
    const queue = createTurnQueue<string, string>({
      run: async (item) => `ran:${item}`,
    })
    await expect(queue.enqueue("a")).resolves.toBe("ran:a")
  })

  it("runs items one at a time, in FIFO submission order", async () => {
    const { run, pending } = deferredRun<string, string>()
    const order: string[] = []
    const queue = createTurnQueue<string, string>({ run })

    const p1 = queue.enqueue("first").then((r) => order.push(r))
    const p2 = queue.enqueue("second").then((r) => order.push(r))
    const p3 = queue.enqueue("third").then((r) => order.push(r))

    // Only the first item has started running; the rest are waiting.
    expect(pending.length).toBe(1)
    expect(pending[0].item).toBe("first")

    pending[0].resolve("first-done")
    await p1
    expect(pending.length).toBe(2)
    expect(pending[1].item).toBe("second")

    pending[1].resolve("second-done")
    await p2
    expect(pending.length).toBe(3)
    expect(pending[2].item).toBe("third")

    pending[2].resolve("third-done")
    await p3

    expect(order).toEqual(["first-done", "second-done", "third-done"])
  })

  it("resolves/rejects each enqueue call with exactly what run() settles with", async () => {
    const queue = createTurnQueue<number, number>({
      run: async (n) => {
        if (n < 0) throw new Error(`negative: ${n}`)
        return n * 2
      },
    })
    await expect(queue.enqueue(3)).resolves.toBe(6)
    await expect(queue.enqueue(-1)).rejects.toThrow("negative: -1")
  })

  it("a turn's failure doesn't wedge the queue — the next item still runs", async () => {
    const queue = createTurnQueue<string, string>({
      run: async (item) => {
        if (item === "bad") throw new Error("boom")
        return `ok:${item}`
      },
    })
    await expect(queue.enqueue("bad")).rejects.toThrow("boom")
    await expect(queue.enqueue("good")).resolves.toBe("ok:good")
  })

  it("notifies onQueueChanged with the waiting list (excluding the in-flight item) on enqueue and dequeue", async () => {
    const { run, pending } = deferredRun<string, string>()
    const snapshots: string[][] = []
    const queue = createTurnQueue<string, string>({
      run,
      onQueueChanged: (waiting) => snapshots.push([...waiting]),
    })

    const p1 = queue.enqueue("a")
    // "a" starts running immediately (queue was idle): the waiting list is
    // empty, not ["a"] — the in-flight item is excluded.
    expect(snapshots.at(-1)).toEqual([])

    queue.enqueue("b")
    // "b" queues behind "a", which is still running.
    expect(snapshots.at(-1)).toEqual(["b"])

    pending[0].resolve("a-done")
    await p1
    // "a" finished, "b" started running: waiting is empty again.
    expect(snapshots.at(-1)).toEqual([])
  })

  it("never calls run() concurrently, even if items enqueue while one is in flight", async () => {
    const active = { count: 0 }
    let sawConcurrent = false
    const queue = createTurnQueue<number, number>({
      run: async (n) => {
        active.count++
        if (active.count > 1) sawConcurrent = true
        await new Promise((r) => setTimeout(r, 1))
        active.count--
        return n
      },
    })
    await Promise.all([queue.enqueue(1), queue.enqueue(2), queue.enqueue(3)])
    expect(sawConcurrent).toBe(false)
  })

  it("does not call onQueueChanged when unset", async () => {
    const spy = vi.fn()
    const queue = createTurnQueue<string, string>({
      run: async (item) => item,
      onQueueChanged: undefined,
    })
    await queue.enqueue("x")
    expect(spy).not.toHaveBeenCalled()
  })
})
