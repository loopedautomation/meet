import type { ParticipantMeta } from "@meet/shared"
import { AccessToken } from "livekit-server-sdk"
import { beforeEach, describe, expect, it } from "vitest"
import { verifyParticipant } from "./participantAuth"

const API_KEY = "devkey"
const API_SECRET = "devsecretdevsecretdevsecretdevsecret"

beforeEach(() => {
  process.env.LIVEKIT_API_KEY = API_KEY
  process.env.LIVEKIT_API_SECRET = API_SECRET
  process.env.LIVEKIT_URL = "ws://livekit:7880"
  process.env.LIVEKIT_PUBLIC_URL = "ws://localhost:7880"
})

async function makeToken(opts: {
  identity: string
  room: string
  kind: ParticipantMeta["kind"]
  name?: string
  apiSecret?: string
  ttl?: number | string
}): Promise<string> {
  const meta: ParticipantMeta = { kind: opts.kind }
  const token = new AccessToken(API_KEY, opts.apiSecret ?? API_SECRET, {
    identity: opts.identity,
    name: opts.name,
    metadata: JSON.stringify(meta),
    ttl: opts.ttl ?? "1h",
  })
  token.addGrant({ room: opts.room, roomJoin: true })
  return token.toJwt()
}

function req(token?: string): Request {
  return new Request("http://x", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

describe("verifyParticipant", () => {
  it("accepts a valid human token and derives identity from the signed sub", async () => {
    const token = await makeToken({
      identity: "user-alice",
      room: "room-1",
      kind: "human",
      name: "Alice",
    })
    const result = await verifyParticipant(req(token), "room-1")
    expect(result).toEqual({
      identity: "user-alice",
      name: "Alice",
      kind: "human",
    })
  })

  it("returns null when the Authorization header is missing", async () => {
    expect(await verifyParticipant(req(), "room-1")).toBeNull()
  })

  it("rejects a token minted for a different room", async () => {
    const token = await makeToken({
      identity: "user-bob",
      room: "other-room",
      kind: "human",
    })
    expect(await verifyParticipant(req(token), "room-1")).toBeNull()
  })

  it("rejects a token signed with the wrong secret (forged)", async () => {
    const token = await makeToken({
      identity: "user-evil",
      room: "room-1",
      kind: "human",
      apiSecret: "attacker-secretattacker-secretattacker",
    })
    expect(await verifyParticipant(req(token), "room-1")).toBeNull()
  })

  it("rejects an expired token", async () => {
    const token = await makeToken({
      identity: "user-late",
      room: "room-1",
      kind: "human",
      // Negative TTL → already expired at mint.
      ttl: -60,
    })
    expect(await verifyParticipant(req(token), "room-1")).toBeNull()
  })

  it("still surfaces a waiting token (routes decide what to do with it)", async () => {
    const token = await makeToken({
      identity: "user-knock",
      room: "room-1",
      kind: "waiting",
    })
    const result = await verifyParticipant(req(token), "room-1")
    expect(result?.kind).toBe("waiting")
  })

  it("rejects garbage in the Authorization header", async () => {
    expect(await verifyParticipant(req("not-a-jwt"), "room-1")).toBeNull()
  })
})
