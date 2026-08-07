import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { $desktopReady, markDesktopReady } from "./desktopReady"

// The vitest environment here is "node" (see vitest.config.ts), so `window`
// isn't a real global — stub it per test rather than assuming it exists,
// mirroring how markDesktopReady itself guards with `typeof window`.
beforeEach(() => {
  $desktopReady.set(false)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("markDesktopReady", () => {
  it("marks the store ready", () => {
    markDesktopReady()
    expect($desktopReady.get()).toBe(true)
  })

  it("tells the desktop shell once, even across repeat calls", () => {
    const ready = vi.fn()
    vi.stubGlobal("window", { meetDesktop: { ready } })
    markDesktopReady()
    markDesktopReady()
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it("does nothing when window (or meetDesktop) is absent, e.g. a plain browser tab with no Electron bridge", () => {
    expect(() => markDesktopReady()).not.toThrow()
    expect($desktopReady.get()).toBe(true)
  })
})
