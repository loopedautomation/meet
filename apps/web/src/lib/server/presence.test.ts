import { pgErrorCode } from "@meet/db"
import { describe, expect, it } from "vitest"
import { isValidChannelSlug } from "./channels"
import { userIdFromIdentity } from "./presence"

describe("userIdFromIdentity", () => {
  it("extracts the user id from member identities", () => {
    expect(userIdFromIdentity("u_0f0f0f0f-1111-2222-3333-444444444444")).toBe(
      "0f0f0f0f-1111-2222-3333-444444444444",
    )
  })

  it("returns null for guests, agents and malformed ids", () => {
    expect(userIdFromIdentity("user-abc123XYZ0")).toBe(null)
    expect(userIdFromIdentity("agent-scout")).toBe(null)
    expect(userIdFromIdentity("u_not-a-uuid")).toBe(null)
    expect(userIdFromIdentity("u_")).toBe(null)
  })
})

describe("isValidChannelSlug", () => {
  it("accepts #handle shapes", () => {
    for (const s of ["standup", "dev-huddle", "a1", "x-2-y"]) {
      expect(isValidChannelSlug(s), s).toBe(true)
    }
  })

  it("rejects everything else", () => {
    for (const s of [
      "a",
      "",
      "Standup",
      "stand up",
      "-standup",
      "standup-",
      "a".repeat(33),
    ]) {
      expect(isValidChannelSlug(s), s).toBe(false)
    }
  })
})

describe("pgErrorCode", () => {
  it("finds the code on the error or its cause chain", () => {
    expect(pgErrorCode({ code: "23505" })).toBe("23505")
    expect(
      pgErrorCode(new Error("wrapped", { cause: { code: "23503" } })),
    ).toBe("23503")
    expect(pgErrorCode(new Error("plain"))).toBe(undefined)
    expect(pgErrorCode({ code: "ENOTFOUND" })).toBe(undefined)
    expect(pgErrorCode(null)).toBe(undefined)
  })
})
