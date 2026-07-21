import { describe, expect, it } from "vitest"
import {
  attachScreenFrame,
  type CapturedFrame,
  screenVisionEnabled,
} from "./screen-capture.js"

/**
 * ScreenCapture itself needs a live LiveKit room, so the parts worth testing
 * are the ones that decide whether an agent sees anything: the env gate and
 * the attach helper every brain-facing path now shares.
 */
type ScreenLike = Parameters<typeof attachScreenFrame>[0]

function fakeScreen(
  frame: CapturedFrame | null,
  { throws = false }: { throws?: boolean } = {},
): ScreenLike {
  return {
    active: frame !== null,
    latestJpeg: async () => {
      if (throws) throw new Error("encode failed")
      return frame
    },
  } as unknown as ScreenLike
}

const frame: CapturedFrame = {
  mediaType: "image/jpeg",
  data: "BASE64",
  sharerName: "Amin",
}

describe("screenVisionEnabled", () => {
  it("is on by default", () => {
    expect(screenVisionEnabled({})).toBe(true)
  })

  it("is off for off/false/0, case- and space-insensitively", () => {
    for (const value of ["off", "OFF", " off ", "false", "0"]) {
      expect(screenVisionEnabled({ AGENT_SCREEN_VISION: value })).toBe(false)
    }
  })

  it("stays on for anything else", () => {
    for (const value of ["on", "true", "1", ""]) {
      expect(screenVisionEnabled({ AGENT_SCREEN_VISION: value })).toBe(true)
    }
  })
})

describe("attachScreenFrame", () => {
  it("passes the text through untouched when nobody is sharing", async () => {
    expect(await attachScreenFrame(fakeScreen(null), "what's up?")).toEqual({
      text: "what's up?",
    })
  })

  it("leaves the turn alone when there is no capture at all", async () => {
    expect(await attachScreenFrame(undefined, "hello")).toEqual({
      text: "hello",
    })
    expect(await attachScreenFrame(null, "hello")).toEqual({ text: "hello" })
  })

  it("attaches the frame and names the sharer", async () => {
    const result = await attachScreenFrame(fakeScreen(frame), "what's this?")
    expect(result.images).toEqual([{ mediaType: "image/jpeg", data: "BASE64" }])
    expect(result.text).toBe(
      "[A current frame of Amin's shared screen is attached.]\nwhat's this?",
    )
  })

  it("tells the model the image is there, not just the brain", async () => {
    // The image alone isn't enough — a model that isn't told it received a
    // screenshot describes the conversation instead of the screen.
    const { text } = await attachScreenFrame(fakeScreen(frame), "q")
    expect(text.startsWith("[A current frame")).toBe(true)
    expect(text.endsWith("q")).toBe(true)
  })

  it("degrades to a plain turn when encoding fails", async () => {
    // A broken frame must not take the whole turn down with it — the agent
    // should answer without the picture rather than not answer at all.
    const result = await attachScreenFrame(
      fakeScreen(frame, { throws: true }),
      "still answer me",
    )
    expect(result).toEqual({ text: "still answer me" })
  })
})
