import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  activityDestinations,
  applySetBroadcast,
  type BroadcastToggleState,
} from "./activity-broadcast.js"

describe("activityDestinations", () => {
  it("broadcasts to everyone (no destination filter) when the toggle is on", () => {
    expect(activityDestinations(true, "user-1")).toBeUndefined()
    expect(activityDestinations(true, null)).toBeUndefined()
  })

  it("targets only the session owner when the toggle is off", () => {
    expect(activityDestinations(false, "user-1")).toEqual(["user-1"])
  })

  it("targets nobody, not everybody, when the toggle is off and no owner is known yet", () => {
    // LiveKit's publishData sends to EVERYONE when destination_identities is
    // an empty array ("will be sent to every one if empty" per the SDK's own
    // DataPublishOptions doc) — so "no owner yet" must resolve to an
    // unreachable identity, never [] and never undefined, or a session with
    // no prompt yet would leak room-wide instead of failing closed.
    const result = activityDestinations(false, null)
    expect(result).not.toBeUndefined()
    expect(result?.length).toBeGreaterThan(0)
  })
})

describe("applySetBroadcast", () => {
  function state(
    overrides: Partial<BroadcastToggleState> = {},
  ): BroadcastToggleState {
    return {
      broadcastEnabled: false,
      lastPromptBy: null,
      lastPromptByName: null,
      ...overrides,
    }
  }

  it("flips broadcastEnabled on the session state (this is the flag activityDestinations reads)", () => {
    const s = state({ broadcastEnabled: false })
    applySetBroadcast(s, true)
    expect(s.broadcastEnabled).toBe(true)

    applySetBroadcast(s, false)
    expect(s.broadcastEnabled).toBe(false)
  })

  it("returns a non-empty attribute value when turning broadcast on, attributed to the last prompter", () => {
    const s = state({
      lastPromptBy: "user-1",
      lastPromptByName: "Ada",
    })
    const attr = applySetBroadcast(s, true)
    expect(attr).toBe("user-1|Ada")
  })

  it("returns the empty-string attribute value when turning broadcast off", () => {
    const s = state({ broadcastEnabled: true })
    const attr = applySetBroadcast(s, false)
    expect(attr).toBe("")
  })

  it("still returns an 'on' attribute value when no prompt owner is known yet", () => {
    const s = state()
    const attr = applySetBroadcast(s, true)
    expect(attr).toBe("|")
  })

  // Regression for #275: the "set-broadcast" AgentControl case existed only
  // in the pipeline-mode dataReceived listener in worker.ts. Realtime-mode
  // agents have their own, separately-maintained listener that never grew a
  // matching case, so toggling broadcast on a realtime agent fired the
  // client-side confirmation toast but had zero server-side effect — the
  // LiveKit attribute was never set and sessionState.broadcastEnabled was
  // never flipped, so publishActivity/activityDestinations kept gating as
  // private. Both listeners now call this single function instead of each
  // hand-rolling the serializeAgentBroadcast(...) call, so there is exactly
  // one implementation of "what does set-broadcast do" to keep in sync.
  it("is the single implementation both the realtime and pipeline dataReceived listeners call for set-broadcast", () => {
    const workerPath = fileURLToPath(new URL("./worker.ts", import.meta.url))
    const worker = readFileSync(workerPath, "utf8")
    const callSites = worker.match(/applySetBroadcast\(/g) ?? []
    // One call per listener (realtime, pipeline) = 2 call sites. If this
    // ever drops to 1, a listener has reverted to inlining/omitting the
    // control again, which is exactly how #275 happened.
    expect(callSites.length).toBe(2)
  })
})
