import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const assertPublicUrl = vi.fn()
vi.mock("@/lib/server/ssrf", () => ({ assertPublicUrl }))

const { extractFirstUrl, fetchLinkPreview } = await import("./linkPreview")

function htmlResponse(html: string, contentType = "text/html; charset=utf-8") {
  return new Response(html, {
    status: 200,
    headers: { "content-type": contentType },
  })
}

beforeEach(() => {
  assertPublicUrl.mockResolvedValue(null)
})
afterEach(() => {
  vi.unstubAllGlobals()
  assertPublicUrl.mockReset()
})

describe("extractFirstUrl", () => {
  it("finds the first bare url in text", () => {
    expect(
      extractFirstUrl("check this out https://example.com/x and more"),
    ).toBe("https://example.com/x")
  })

  it("returns null when there's no url", () => {
    expect(extractFirstUrl("just some text")).toBeNull()
  })

  it("trims trailing sentence punctuation", () => {
    expect(extractFirstUrl("see (https://example.com/x).")).toBe(
      "https://example.com/x",
    )
  })
})

describe("fetchLinkPreview", () => {
  it("returns null when the SSRF guard rejects the url", async () => {
    assertPublicUrl.mockResolvedValue("internal addresses are not allowed")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    expect(await fetchLinkPreview("http://10.0.0.5/")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("parses og tags, falls back to <title>, resolves a relative image", async () => {
    const html = `<!doctype html><html><head>
      <title>Fallback Title</title>
      <meta content="A cool site" property="og:title">
      <meta property="og:description" content="Some &amp; description">
      <meta property="og:image" content="/img/card.png">
      <meta property="og:site_name" content="Example">
    </head></html>`
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(htmlResponse(html)))
    const preview = await fetchLinkPreview("https://example.com/post")
    expect(preview).toEqual({
      url: "https://example.com/post",
      title: "A cool site",
      description: "Some & description",
      image: "https://example.com/img/card.png",
      siteName: "Example",
    })
  })

  it("returns null for a non-HTML content type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("%PDF-1.4", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      ),
    )
    expect(await fetchLinkPreview("https://example.com/doc.pdf")).toBeNull()
  })

  it("returns null when the fetch throws (timeout, network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timed out")))
    expect(await fetchLinkPreview("https://slow.example.com/")).toBeNull()
  })

  it("returns null when the page has no title at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(htmlResponse("<html><head></head></html>")),
    )
    expect(await fetchLinkPreview("https://example.com/blank")).toBeNull()
  })

  it("caches by url, without re-fetching within the TTL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(htmlResponse("<title>Cached</title>"))
    vi.stubGlobal("fetch", fetchMock)
    await fetchLinkPreview("https://example.com/cache-me")
    await fetchLinkPreview("https://example.com/cache-me")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
