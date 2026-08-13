import { getDb, sql } from "@meet/db"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { canAccessChannel, getChannelByRoomName } from "@/lib/server/channels"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getMemberUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ room: string }> }

// One page of the results side panel; "load more" bumps offset by this.
const PAGE_SIZE = 20
// Guards the client-supplied offset against a runaway OFFSET scan.
const MAX_OFFSET = 2000

/**
 * Channel search v1: the same Postgres FTS pattern as the global sidebar
 * search (`/api/search`) — `to_tsvector`/`plainto_tsquery` over
 * `messages.content`, via the `messages_content_fts_idx` GIN index — but
 * scoped to a single channel the viewer already has access to, with offset
 * pagination for the results panel's "load more".
 */
export async function GET(request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  // Own bucket, distinct from the global search route's `search:` prefix —
  // heavy in-channel search shouldn't share (or exhaust) that allowance.
  if (rateLimited(`channel-search:${clientKey(request)}`, 30, 60 * 1000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 })
  }
  const { room } = await params
  const channel = await getChannelByRoomName(room)
  if (!channel || !(await canAccessChannel(channel, user.id))) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 })
  }
  const url = new URL(request.url)
  const q = url.searchParams.get("q")?.trim() ?? ""
  if (q.length < 2 || q.length > 200)
    return NextResponse.json({ results: [], hasMore: false })

  const rawOffset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10)
  const offset = Number.isFinite(rawOffset)
    ? Math.min(Math.max(rawOffset, 0), MAX_OFFSET)
    : 0

  // Fetch one extra row to know whether there's another page, instead of a
  // separate count(*) query.
  const results = await getDb().execute(sql`
    select m.id, m.content, m.created_at,
           coalesce(u.name, u.email, m.author_agent_id, 'someone') as author,
           u.image as author_image,
           ts_headline('english', m.content, plainto_tsquery('english', ${q}),
                       'MaxWords=18, MinWords=8, StartSel=**, StopSel=**') as snippet
    from messages m
    left join users u on u.id = m.author_user_id
    where m.channel_id = ${channel.id}
      and m.deleted_at is null
      and to_tsvector('english', m.content) @@ plainto_tsquery('english', ${q})
    order by m.created_at desc
    limit ${PAGE_SIZE + 1} offset ${offset}
  `)
  const rows = results.rows
  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  return NextResponse.json({
    results: page.map((r) => ({
      id: r.id,
      author: r.author,
      authorImage: r.author_image ?? null,
      // Plain text — ts_headline marks matches with **, never HTML.
      snippet: r.snippet,
      at: new Date(r.created_at as string).getTime(),
    })),
    hasMore,
  })
}
