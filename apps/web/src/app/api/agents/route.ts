import { getDb, hasDatabase, schema } from "@meet/db"
import { NextResponse } from "next/server"
import { bridgeFetch } from "@/lib/server/bridge"

type RosterAgent = { id: string; name?: string; description?: string }

/** The agent roster: the bridge's registry plus this server's durable
 * external agents (never their URLs or tokens). */
export async function GET() {
  let agents: RosterAgent[] = []
  try {
    const res = await bridgeFetch("/agents")
    if (!res.ok) throw new Error(`bridge responded ${res.status}`)
    const data = (await res.json()) as { agents?: RosterAgent[] }
    agents = data.agents ?? []
  } catch {
    // Registry roster is best-effort; external agents can still list.
  }
  if (hasDatabase()) {
    try {
      const external = await getDb()
        .select({
          id: schema.externalAgents.id,
          name: schema.externalAgents.name,
          description: schema.externalAgents.description,
        })
        .from(schema.externalAgents)
      agents = [
        ...agents,
        ...external.map((a) => ({
          id: a.id,
          name: a.name,
          ...(a.description ? { description: a.description } : {}),
        })),
      ]
    } catch {
      // Roster stays partial rather than failing the request.
    }
  }
  return NextResponse.json({ agents })
}
