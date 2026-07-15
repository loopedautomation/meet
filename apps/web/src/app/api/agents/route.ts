import { NextResponse } from "next/server"
import { bridgeFetch } from "@/lib/server/bridge"

export async function GET() {
  try {
    const res = await bridgeFetch("/agents")
    if (!res.ok) throw new Error(`bridge responded ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ agents: [] })
  }
}
