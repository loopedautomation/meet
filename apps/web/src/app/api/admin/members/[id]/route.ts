import { eq, getDb, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authMode } from "@/lib/server/authMode"
import { revokeUserDesktopSessions } from "@/lib/server/desktopSession"
import { getMemberUser } from "@/lib/server/session"

type Params = { params: Promise<{ id: string }> }

const roleSchema = z.object({ role: z.enum(["admin", "member"]) })

/** Change a member's role. Owner only; the owner role itself never moves
 * this way. */
export async function PATCH(request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (user?.role !== "owner") {
    return NextResponse.json({ error: "owner required" }, { status: 403 })
  }
  const { id } = await params
  const body = roleSchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: "role required" }, { status: 400 })
  const target = await getDb().query.memberships.findFirst({
    where: eq(schema.memberships.userId, id),
  })
  if (!target)
    return NextResponse.json({ error: "not a member" }, { status: 404 })
  if (target.role === "owner") {
    return NextResponse.json(
      { error: "the owner role doesn't move this way" },
      { status: 400 },
    )
  }
  await getDb()
    .update(schema.memberships)
    .set({ role: body.data.role })
    .where(eq(schema.memberships.userId, id))
  return NextResponse.json({ ok: true })
}

/**
 * Remove a member (admin+; admins can't remove admins, nobody removes the
 * owner or themselves here). With ?purge=1 the owner erases the account
 * entirely — the GDPR delete: the users row goes, cascades take
 * memberships/reads/reactions/presence, and message authorship nulls out.
 */
export async function DELETE(request: Request, { params }: Params) {
  if (authMode() === "none")
    return NextResponse.json({ error: "not found" }, { status: 404 })
  const user = await getMemberUser()
  if (!user || user.role === "member") {
    return NextResponse.json({ error: "admin required" }, { status: 403 })
  }
  const { id } = await params
  if (id === user.id) {
    return NextResponse.json(
      { error: "you can't remove yourself" },
      { status: 400 },
    )
  }
  const db = getDb()
  const target = await db.query.memberships.findFirst({
    where: eq(schema.memberships.userId, id),
  })
  if (!target)
    return NextResponse.json({ error: "not a member" }, { status: 404 })
  if (target.role === "owner") {
    return NextResponse.json(
      { error: "the owner can't be removed" },
      { status: 400 },
    )
  }
  if (target.role === "admin" && user.role !== "owner") {
    return NextResponse.json(
      { error: "only the owner removes admins" },
      { status: 403 },
    )
  }
  const purge = new URL(request.url).searchParams.get("purge") === "1"
  if (purge) {
    if (user.role !== "owner") {
      return NextResponse.json(
        { error: "owner required to purge" },
        { status: 403 },
      )
    }
    await db.delete(schema.users).where(eq(schema.users.id, id))
  } else {
    await db.delete(schema.memberships).where(eq(schema.memberships.userId, id))
  }
  // Membership gone (or account purged — cascade got the rows already):
  // signed-in desktop shells must not keep a live session.
  await revokeUserDesktopSessions(id)
  return NextResponse.json({ ok: true })
}
