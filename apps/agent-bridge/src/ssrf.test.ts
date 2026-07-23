import { afterEach, describe, expect, it, vi } from "vitest"

// Mock both DNS surfaces the module uses: the promise `lookup` (invite-time
// validation) and the callback `lookup` (connect-time guard).
const promiseLookup = vi.fn()
const cbLookup = vi.fn()
vi.mock("node:dns/promises", () => ({ lookup: promiseLookup }))
vi.mock("node:dns", () => ({ lookup: cbLookup }))

const { assertPublicAgentUrl, publicOnlyLookup } = await import("./dynamic.js")

afterEach(() => {
  promiseLookup.mockReset()
  cbLookup.mockReset()
  delete process.env.DYNAMIC_AGENTS_ALLOW_PRIVATE
})

describe("assertPublicAgentUrl (invite-time SSRF guard)", () => {
  it("rejects a literal private IPv4 without a DNS lookup", async () => {
    expect(await assertPublicAgentUrl("ws://10.0.0.5/tty")).toMatch(/internal/)
    expect(await assertPublicAgentUrl("ws://192.168.1.1/tty")).toMatch(
      /internal/,
    )
    expect(await assertPublicAgentUrl("ws://172.16.0.1/tty")).toMatch(
      /internal/,
    )
    expect(promiseLookup).not.toHaveBeenCalled()
  })

  it("rejects the cloud metadata address", async () => {
    expect(await assertPublicAgentUrl("ws://169.254.169.254/tty")).toMatch(
      /internal/,
    )
  })

  it("rejects loopback and IPv6 loopback", async () => {
    expect(await assertPublicAgentUrl("ws://127.0.0.1/tty")).toMatch(/internal/)
    expect(await assertPublicAgentUrl("ws://[::1]/tty")).toMatch(/internal/)
  })

  it("rejects a hostname that resolves to a private address", async () => {
    promiseLookup.mockResolvedValue([{ address: "10.1.2.3", family: 4 }])
    expect(await assertPublicAgentUrl("wss://evil.example.com/tty")).toMatch(
      /internal/,
    )
  })

  it("allows a hostname that resolves to a public address", async () => {
    promiseLookup.mockResolvedValue([{ address: "203.0.113.9", family: 4 }])
    expect(await assertPublicAgentUrl("wss://agent.example.com/tty")).toBeNull()
  })

  it("rejects a hostname that resolves to a mix including a private address", async () => {
    promiseLookup.mockResolvedValue([
      { address: "203.0.113.9", family: 4 },
      { address: "10.0.0.9", family: 4 },
    ])
    expect(await assertPublicAgentUrl("wss://sneaky.example.com/tty")).toMatch(
      /internal/,
    )
  })

  it("fails closed when resolution errors", async () => {
    promiseLookup.mockRejectedValue(new Error("nxdomain"))
    expect(await assertPublicAgentUrl("wss://nope.example.com/tty")).toMatch(
      /could not resolve/,
    )
  })

  it("opts out entirely when DYNAMIC_AGENTS_ALLOW_PRIVATE=1", async () => {
    process.env.DYNAMIC_AGENTS_ALLOW_PRIVATE = "1"
    expect(await assertPublicAgentUrl("ws://10.0.0.5/tty")).toBeNull()
  })
})

describe("publicOnlyLookup (connect-time rebinding guard)", () => {
  it("errors when the host resolves to a private address at dial time", async () => {
    cbLookup.mockImplementation((_h, _o, cb) =>
      cb(null, [{ address: "10.0.0.9", family: 4 }]),
    )
    const err = await new Promise((resolve) =>
      publicOnlyLookup("evil.example.com", { all: true }, (e: unknown) =>
        resolve(e),
      ),
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/internal/)
  })

  it("passes through public addresses at dial time", async () => {
    cbLookup.mockImplementation((_h, _o, cb) =>
      cb(null, [{ address: "203.0.113.9", family: 4 }]),
    )
    const result = await new Promise((resolve, reject) =>
      publicOnlyLookup(
        "agent.example.com",
        { all: true },
        (e: unknown, addrs: unknown) => (e ? reject(e) : resolve(addrs)),
      ),
    )
    expect(result).toEqual([{ address: "203.0.113.9", family: 4 }])
  })
})
