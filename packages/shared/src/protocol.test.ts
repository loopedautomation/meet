import { describe, expect, it } from "vitest"
import {
  checkCompatibility,
  MIN_CLIENT_PROTOCOL,
  PROTOCOL_VERSION,
  SERVICE_ID,
} from "./protocol"

const server = (over: Record<string, unknown> = {}) => ({
  ok: true,
  service: SERVICE_ID,
  protocol: PROTOCOL_VERSION,
  minClientProtocol: MIN_CLIENT_PROTOCOL,
  version: "0.1.0",
  ...over,
})

describe("checkCompatibility", () => {
  it("accepts a matching server", () => {
    const result = checkCompatibility(
      server(),
      PROTOCOL_VERSION,
      PROTOCOL_VERSION,
    )
    expect(result.ok).toBe(true)
  })

  // The case that motivated the marker: a typo'd hostname landing on some
  // unrelated service that happens to answer 200 on /api/health.
  it.each([
    ["a foreign 200", { ok: true }],
    ["the old bare health body", { ok: true, status: "healthy" }],
    ["a wrong service marker", server({ service: "other-app" })],
    ["a non-numeric protocol", server({ protocol: "1" })],
    ["null", null],
    ["a string body", "ok"],
  ])("rejects %s as not-a-meet-server", (_label, body) => {
    const result = checkCompatibility(body, PROTOCOL_VERSION, PROTOCOL_VERSION)
    expect(result).toEqual({ ok: false, reason: "not-a-meet-server" })
  })

  it("reports client-too-old when the server has dropped our protocol", () => {
    const result = checkCompatibility(
      server({ protocol: 5, minClientProtocol: 3 }),
      2,
      1,
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe("client-too-old")
  })

  it("reports server-too-old when the server predates what we support", () => {
    const result = checkCompatibility(
      server({ protocol: 1, minClientProtocol: 1 }),
      5,
      3,
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe("server-too-old")
  })

  // Both sides out of range: blame the client, since updating the app is
  // the one action the user can take themselves.
  it("prefers client-too-old when neither side is in range", () => {
    const result = checkCompatibility(
      server({ protocol: 1, minClientProtocol: 9 }),
      5,
      3,
    )
    expect(result.ok === false && result.reason).toBe("client-too-old")
  })

  // Newer servers stay usable: a client one version behind is still inside
  // the support window, which is the whole point of advertising a window.
  it("accepts a newer server that still supports us", () => {
    const result = checkCompatibility(
      server({ protocol: 4, minClientProtocol: 2 }),
      3,
      1,
    )
    expect(result.ok).toBe(true)
  })

  it("defaults a missing version to unknown rather than failing", () => {
    const result = checkCompatibility(
      server({ version: undefined }),
      PROTOCOL_VERSION,
      PROTOCOL_VERSION,
    )
    expect(result.ok && result.server.version).toBe("unknown")
  })
})
