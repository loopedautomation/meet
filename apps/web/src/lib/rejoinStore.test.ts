import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearRejoin,
  clearRejoinIfToken,
  isRejoinFresh,
  readRejoin,
  REJOIN_MAX_AGE_MS,
  rejoinToken,
  writeRejoin,
} from "./rejoinStore"
import { roomAuthHeaders } from "./roomAuth"

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

const prefs = { displayName: "Ada", audioEnabled: true, videoEnabled: false }

describe("rejoin store", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", memoryStorage())
    vi.stubGlobal("localStorage", memoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("round-trips a written proof", () => {
    writeRejoin("room-a", { prefs, rejoinToken: "tok" })
    expect(readRejoin("room-a")).toMatchObject({ prefs, rejoinToken: "tok" })
  })

  it("keeps rooms separate", () => {
    writeRejoin("room-a", { prefs, rejoinToken: "tok" })
    expect(readRejoin("room-b")).toBeNull()
  })

  it("reads back entries in the legacy top-level-prefs shape", () => {
    sessionStorage.setItem("rejoin:room-a", JSON.stringify(prefs))
    expect(readRejoin("room-a")?.prefs).toEqual(prefs)
  })

  it("returns null rather than throwing on unparseable data", () => {
    sessionStorage.setItem("rejoin:room-a", "{not json")
    expect(readRejoin("room-a")).toBeNull()
    sessionStorage.setItem("rejoin:room-b", "null")
    expect(readRejoin("room-b")).toBeNull()
  })

  // Proofs written before this store lived in localStorage; the first read
  // imports them so a deploy doesn't bounce mid-meeting users to the lobby —
  // and evicts the localStorage copy, which is a live bearer credential
  // nothing else would ever delete.
  it("migrates a legacy localStorage proof and evicts the original", () => {
    localStorage.setItem(
      "rejoin:room-a",
      JSON.stringify({ prefs, rejoinToken: "old", savedAt: Date.now() }),
    )
    expect(readRejoin("room-a")).toMatchObject({ rejoinToken: "old" })
    expect(localStorage.getItem("rejoin:room-a")).toBeNull()
    // Now owned by sessionStorage: later reads don't depend on localStorage.
    expect(readRejoin("room-a")).toMatchObject({ rejoinToken: "old" })
  })

  it("prefers the sessionStorage proof over an unmigrated legacy one", () => {
    writeRejoin("room-a", { prefs, rejoinToken: "current" })
    localStorage.setItem(
      "rejoin:room-a",
      JSON.stringify({ prefs, rejoinToken: "stale" }),
    )
    expect(readRejoin("room-a")?.rejoinToken).toBe("current")
  })

  it("writes and clears evict any legacy localStorage copy", () => {
    localStorage.setItem("rejoin:room-a", "legacy")
    writeRejoin("room-a", { prefs, rejoinToken: "tok" })
    expect(localStorage.getItem("rejoin:room-a")).toBeNull()

    localStorage.setItem("rejoin:room-a", "legacy-again")
    clearRejoin("room-a")
    expect(localStorage.getItem("rejoin:room-a")).toBeNull()
    expect(readRejoin("room-a")).toBeNull()
  })

  it("clears only when the token still matches this session's", () => {
    writeRejoin("room-a", { prefs, rejoinToken: "newer-tab-token" })
    clearRejoinIfToken("room-a", "our-older-token")
    expect(readRejoin("room-a")).not.toBeNull()
    clearRejoinIfToken("room-a", "newer-tab-token")
    expect(readRejoin("room-a")).toBeNull()
  })

  it("treats a proof past the token TTL as stale", () => {
    const fresh = { prefs, savedAt: Date.now() }
    const stale = { prefs, savedAt: Date.now() - REJOIN_MAX_AGE_MS - 1 }
    expect(isRejoinFresh(fresh)).toBe(true)
    expect(isRejoinFresh(stale)).toBe(false)
    expect(isRejoinFresh(null)).toBe(false)
    // Pre-savedAt entries can't be dated, so they never auto-join.
    expect(isRejoinFresh({ prefs })).toBe(false)
  })

  // The #259 regression: the writer and the reader of the proof disagreed on
  // where it lived, so every room-scoped API call went out unauthenticated.
  it("sends the written proof as the room API's bearer token", () => {
    expect(roomAuthHeaders("room-a")).toEqual({})
    writeRejoin("room-a", { prefs, rejoinToken: "tok" })
    expect(rejoinToken("room-a")).toBe("tok")
    expect(roomAuthHeaders("room-a")).toEqual({ authorization: "Bearer tok" })
    clearRejoin("room-a")
    expect(roomAuthHeaders("room-a")).toEqual({})
  })
})
