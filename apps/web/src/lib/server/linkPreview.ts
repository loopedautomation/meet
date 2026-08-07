import { assertPublicUrl } from "@/lib/server/ssrf"

export type LinkPreview = {
  url: string
  title?: string
  description?: string
  image?: string
  siteName?: string
}

const FETCH_TIMEOUT_MS = 5000
// OG tags live in <head>; capping how much of the body we read bounds
// both memory and time on a page that never closes </head>.
const MAX_BYTES = 100_000
const CACHE_TTL_MS = 10 * 60 * 1000

const cache = new Map<string, { data: LinkPreview | null; expiresAt: number }>()

/** First bare URL in a chat message, matching what remark-gfm would
 * autolink closely enough — trailing punctuation is trimmed so a link at
 * the end of a sentence doesn't drag a period or closing paren along. */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S+/)
  if (!match) return null
  return match[0].replace(/[.,!?;:'")\]}>]+$/, "")
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .trim()
}

/** Reads a <meta> tag's content by property/name, regardless of which
 * attribute (property/name vs. content) comes first in the source. */
function extractMeta(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(
    `<meta[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']|` +
      `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`,
    "i",
  )
  const m = html.match(re)
  const raw = m?.[1] ?? m?.[2]
  return raw ? decodeEntities(raw) : undefined
}

function extractTitleTag(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return m ? decodeEntities(m[1]) : undefined
}

async function readBoundedText(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return (await res.text()).slice(0, MAX_BYTES)
  const decoder = new TextDecoder()
  let text = ""
  let bytes = 0
  try {
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
  return text
}

/**
 * Fetches OG metadata for a URL pasted into chat. Called fire-and-forget
 * after a message is persisted (see the messages POST route) — every
 * failure mode (unreachable, not HTML, no OG data, private address)
 * resolves to null rather than throwing, since a broken/slow link must
 * never affect the message it was pasted in.
 */
export async function fetchLinkPreview(
  url: string,
): Promise<LinkPreview | null> {
  const cached = cache.get(url)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  const data = await fetchLinkPreviewUncached(url)
  cache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return data
}

async function fetchLinkPreviewUncached(
  url: string,
): Promise<LinkPreview | null> {
  if ((await assertPublicUrl(url)) !== null) return null

  let res: Response
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "text/html" },
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const contentType = res.headers.get("content-type") ?? ""
  if (!contentType.includes("text/html")) return null

  const html = await readBoundedText(res)
  const title = extractMeta(html, "og:title") ?? extractTitleTag(html)
  if (!title) return null

  const description =
    extractMeta(html, "og:description") ??
    extractMeta(html, "twitter:description")
  const rawImage =
    extractMeta(html, "og:image") ?? extractMeta(html, "twitter:image")
  const siteName = extractMeta(html, "og:site_name")

  let image: string | undefined
  if (rawImage) {
    try {
      image = new URL(rawImage, res.url || url).toString()
    } catch {
      image = undefined
    }
  }

  return { url, title, description, image, siteName }
}
