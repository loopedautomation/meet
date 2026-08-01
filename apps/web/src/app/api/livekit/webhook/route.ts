import { hasDatabase } from "@meet/db"
import { parseParticipantMeta } from "@meet/shared"
import { WebhookReceiver } from "livekit-server-sdk"
import { NextResponse } from "next/server"
import { livekitEnv } from "@/lib/server/livekit"
import {
  presenceClearRoom,
  presenceJoin,
  presenceLeave,
} from "@/lib/server/presence"

let receiver: WebhookReceiver | null = null

/**
 * LiveKit webhook sink → room_presence. The push half of "who's in
 * #standup": participant_joined/left maintain rows, room_finished clears a
 * room wholesale (self-healing against missed events). Verification needs
 * the RAW body — LiveKit signs a sha256 of the exact bytes into the
 * Authorization JWT — so this handler must read text() before anything
 * parses it. LiveKit retries failed deliveries, so a briefly-down web
 * container catches up on its own.
 */
export async function POST(request: Request) {
  // Databaseless deployments have nowhere to write presence; acknowledge so
  // LiveKit doesn't retry forever.
  if (!hasDatabase()) return NextResponse.json({ ok: true })

  const { apiKey, apiSecret } = livekitEnv()
  if (!receiver) receiver = new WebhookReceiver(apiKey, apiSecret)

  const body = await request.text()
  const auth = request.headers.get("authorization") ?? ""
  let event: Awaited<ReturnType<WebhookReceiver["receive"]>>
  try {
    event = await receiver.receive(body, auth)
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 })
  }

  const roomName = event.room?.name
  try {
    switch (event.event) {
      case "participant_joined": {
        if (!roomName || !event.participant) break
        const meta = parseParticipantMeta(event.participant.metadata)
        await presenceJoin({
          roomName,
          identity: event.participant.identity,
          displayName: event.participant.name || undefined,
          kind: meta?.kind,
        })
        break
      }
      case "participant_left": {
        if (!roomName || !event.participant) break
        await presenceLeave(roomName, event.participant.identity)
        break
      }
      case "room_finished": {
        if (!roomName) break
        await presenceClearRoom(roomName)
        break
      }
      default:
        break
    }
  } catch (err) {
    // A transient DB error: 500 so LiveKit redelivers.
    console.error("webhook: presence update failed", err)
    return NextResponse.json(
      { error: "presence update failed" },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
}
