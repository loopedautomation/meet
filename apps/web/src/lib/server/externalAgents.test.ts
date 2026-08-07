import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  decryptToken,
  encryptToken,
  generateExternalAgentId,
  generateRegistrationToken,
  sha256Hex,
} from "./externalAgents"

describe("token encryption", () => {
  beforeEach(() => {
    process.env.AGENT_TOKEN_ENC_KEY = randomBytes(32).toString("base64")
  })

  afterEach(() => {
    delete process.env.AGENT_TOKEN_ENC_KEY
  })

  it("round-trips a token", () => {
    const ciphertext = encryptToken("super-secret-token")
    expect(ciphertext.startsWith("v1:")).toBe(true)
    expect(ciphertext).not.toContain("super-secret-token")
    expect(decryptToken(ciphertext)).toBe("super-secret-token")
  })

  it("produces a fresh iv per encryption", () => {
    expect(encryptToken("t")).not.toBe(encryptToken("t"))
  })

  it("rejects tampered ciphertext", () => {
    const ciphertext = encryptToken("secret")
    const parts = ciphertext.split(":")
    parts[3] = Buffer.from("tampered!").toString("base64")
    expect(() => decryptToken(parts.join(":"))).toThrow()
  })

  it("rejects an unrecognized format", () => {
    expect(() => decryptToken("v2:a:b:c")).toThrow(/format/)
  })

  it("refuses a short key", () => {
    process.env.AGENT_TOKEN_ENC_KEY = Buffer.from("short").toString("base64")
    expect(() => encryptToken("x")).toThrow(/32 bytes/)
  })

  it("refuses a missing key", () => {
    delete process.env.AGENT_TOKEN_ENC_KEY
    expect(() => encryptToken("x")).toThrow(/AGENT_TOKEN_ENC_KEY/)
  })
})

describe("registration tokens and ids", () => {
  it("generates lreg_<32hex> tokens", () => {
    expect(generateRegistrationToken()).toMatch(/^lreg_[0-9a-f]{32}$/)
  })

  it("generates ext-<8hex> agent ids", () => {
    expect(generateExternalAgentId()).toMatch(/^ext-[0-9a-f]{8}$/)
  })

  it("hashes deterministically", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"))
    expect(sha256Hex("abc")).toMatch(/^[0-9a-f]{64}$/)
  })
})
