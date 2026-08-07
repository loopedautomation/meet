import { afterEach, describe, expect, it, vi } from "vitest"

const promiseLookup = vi.fn()
vi.mock("node:dns/promises", () => ({ lookup: promiseLookup }))

const { assertPublicUrl } = await import("./ssrf.js")

afterEach(() => {
  promiseLookup.mockReset()
})

describe("assertPublicUrl", () => {
  it("rejects non-http(s) protocols", async () => {
    expect(await assertPublicUrl("file:///etc/passwd")).toMatch(/http/)
    expect(promiseLookup).not.toHaveBeenCalled()
  })

  it("rejects an invalid url", async () => {
    expect(await assertPublicUrl("not a url")).toBe("invalid url")
  })

  it("rejects a literal private IPv4 without a DNS lookup", async () => {
    expect(await assertPublicUrl("http://10.0.0.5/")).toMatch(/internal/)
    expect(await assertPublicUrl("http://192.168.1.1/")).toMatch(/internal/)
    expect(await assertPublicUrl("http://172.16.0.1/")).toMatch(/internal/)
    expect(promiseLookup).not.toHaveBeenCalled()
  })

  it("rejects the cloud metadata address", async () => {
    expect(await assertPublicUrl("http://169.254.169.254/")).toMatch(/internal/)
  })

  it("rejects loopback and IPv6 loopback", async () => {
    expect(await assertPublicUrl("http://127.0.0.1/")).toMatch(/internal/)
    expect(await assertPublicUrl("http://[::1]/")).toMatch(/internal/)
  })

  it("rejects a hostname that resolves to a private address", async () => {
    promiseLookup.mockResolvedValue([{ address: "10.1.2.3", family: 4 }])
    expect(await assertPublicUrl("https://evil.example.com/")).toMatch(
      /internal/,
    )
  })

  it("allows a hostname that resolves to a public address", async () => {
    promiseLookup.mockResolvedValue([{ address: "203.0.113.9", family: 4 }])
    expect(await assertPublicUrl("https://example.com/")).toBeNull()
  })

  it("rejects a hostname that resolves to a mix including a private address", async () => {
    promiseLookup.mockResolvedValue([
      { address: "203.0.113.9", family: 4 },
      { address: "10.0.0.9", family: 4 },
    ])
    expect(await assertPublicUrl("https://sneaky.example.com/")).toMatch(
      /internal/,
    )
  })

  it("fails closed when resolution errors", async () => {
    promiseLookup.mockRejectedValue(new Error("nxdomain"))
    expect(await assertPublicUrl("https://nope.example.com/")).toMatch(
      /could not resolve/,
    )
  })
})
