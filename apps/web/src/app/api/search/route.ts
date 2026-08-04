import { getDb, sql } from "@meet/db"
import { NextResponse } from "next/server"
import { authMode } from "@/lib/server/authMode"
import { clientKey, rateLimited } from "@/lib/server/rateLimit"
import { getMemberUser } from "@/lib/server/session"

export const dynamic = "force-dynamic"

/**
 * Search v1: Postgres full-text over message content, scoped to channels
 * the viewer can see (public ones, plus private/DMs they belong to).
 */
export async function GET(request: Request) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user)
    return NextResponse.json({ error: "membership required" }, { status: 401 })
  if (rateLimited(`search:${clientKey(request)}`, 30, 60 * 1000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 })
  }
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? ""
  if (q.length < 2 || q.length > 200) return NextResponse.json({ results: [] })

  const results = await getDb().execute(sql`
    select m.id, m.content, m.created_at, c.slug, c.is_dm,
           coalesce(u.name, u.email, m.author_agent_id, 'someone') as author,
           ts_headline('english', m.content, plainto_tsquery('english', ${q}),
                       'MaxWords=18, MinWords=8, StartSel=**, StopSel=**') as snippet
    from messages m
    join channels c on c.id = m.channel_id
    left join users u on u.id = m.author_user_id
    where m.deleted_at is null
      and c.archived_at is null
      and (not c.is_private or exists (
        select 1 from channel_members cm
        where cm.channel_id = c.id and cm.user_id = ${user.id}
      ))
      and to_tsvector('english', m.content) @@ plainto_tsquery('english', ${q})
    order by m.created_at desc
    limit 20
  `)
  return NextResponse.json({
    results: results.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      isDm: r.is_dm,
      author: r.author,
      snippet: r.snippet,
      at: new Date(r.created_at as string).getTime(),
    })),
  })
}
