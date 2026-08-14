/**
 * A generic FIFO turn queue: items enqueued while one is already running
 * wait their turn and run automatically, one at a time, in submission order.
 *
 * Built for the agent-bridge's chat/prompt turns — a second `@mention` (or
 * panel prompt) arriving while a turn is in flight used to race the brain
 * transport or get silently swallowed by a busy-error regex match. This
 * replaces that with a real queue whose waiting contents a caller can render
 * in the UI (see `onQueueChanged`).
 *
 * Deliberately independent of any LiveKit/job-context glue, so its
 * correctness (order, serialization, per-item settlement, failure
 * isolation, change notification) is unit-testable in isolation — see
 * turn-queue.test.ts.
 */
export type TurnQueue<TItem, TResult> = {
  /**
   * Add an item to the queue. Resolves or rejects with exactly what `run`
   * settles with for this item, once it's this item's turn to run.
   */
  enqueue: (item: TItem) => Promise<TResult>
}

export function createTurnQueue<TItem, TResult>(opts: {
  /** Executes one item. Only ever called for one item at a time. */
  run: (item: TItem) => Promise<TResult>
  /**
   * Called with the current WAITING list (the in-flight item, if any, is
   * excluded) right after any change to it — an item joining or an item
   * starting to run. A caller publishes this as the UI-visible queue
   * snapshot.
   */
  onQueueChanged?: (waiting: TItem[]) => void
}): TurnQueue<TItem, TResult> {
  type Entry = {
    item: TItem
    resolve: (result: TResult) => void
    reject: (err: unknown) => void
  }
  const waiting: Entry[] = []
  let running = false

  const notify = () => {
    opts.onQueueChanged?.(waiting.map((e) => e.item))
  }

  const pump = () => {
    if (running) return
    const next = waiting.shift()
    if (!next) return
    // The shifted item is now in flight, not waiting — notify with the
    // list as it stands post-dequeue.
    notify()
    running = true
    opts.run(next.item).then(
      (result) => {
        // Advance the queue (and notify) before settling this item's own
        // promise, so a caller chaining off enqueue() never observes a
        // queue state that's one step behind what onQueueChanged reported.
        running = false
        pump()
        next.resolve(result)
      },
      (err) => {
        running = false
        pump()
        next.reject(err)
      },
    )
  }

  return {
    enqueue(item: TItem): Promise<TResult> {
      return new Promise<TResult>((resolve, reject) => {
        waiting.push({ item, resolve, reject })
        notify()
        pump()
      })
    },
  }
}
