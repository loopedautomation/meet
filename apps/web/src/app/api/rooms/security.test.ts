/**
 * Adversarial tests for the room authorization routes — each one encodes an
 * attack from the security audits and asserts it stays closed: start-gate
 * bypass, waiting-room bypass, admission spoofing, kick/rejoin, and
 * unauthenticated doc access. LiveKit's server SDK is mocked at the
 * service-client boundary; tokens are real signed JWTs so the verification
 * paths run for real.
 */
import type { ParticipantMeta } from "@meet/shared"
import { AccessToken } from "livekit-server-sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"

const API_KEY = "test-api-key"
const API_SECRET = "test-api-secret-0123456789abcdef"

// A single mutable fake LiveKit room-service; each test seeds its state.
type Participant = { identity: string; metadata: string; tracks?: unknown[] }
const state: {
  rooms: Array<{ name: string; metadata: string; creationTime?: number }>
  participants: Participant[]
  listRoomsThrows: boolean
  listParticipantsThrows: boolean
  removeThrows: boolean
} = {
  rooms: [],
  participants: [],
  listRoomsThrows: false,
  listParticipantsThrows: false,
  removeThrows: false,
}

const updateParticipant = vi.fn()
const removeParticipant = vi.fn()
const updateRoomMetadata = vi.fn()

vi.mock("@/lib/server/livekit", () => ({
  livekitEnv: () => ({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    url: "ws://livekit:7880",
    publicUrl: "ws://localhost:7880",
  }),
  roomService: () => ({
    listRooms: async () => {
      if (state.listRoomsThrows) throw new Error("livekit down")
      return state.rooms
    },
    createRoom: async (opts: { name: string; metadata: string }) => {
      const room = { ...opts, creationTime: 0 }
      state.rooms.push(room)
      return room
    },
    listParticipants: async () => {
      if (state.listParticipantsThrows) throw new Error("livekit down")
      return state.participants
    },
    updateRoomMetadata: async (slug: string, meta: string) => {
      updateRoomMetadata(slug, meta)
      const r = state.rooms.find((x) => x.name === slug)
      if (r) r.metadata = meta
    },
    updateParticipant: (...args: unknown[]) => {
      updateParticipant(...args)
      return Promise.resolve()
    },
    removeParticipant: (...args: unknown[]) => {
      removeParticipant(...args)
      if (state.removeThrows) return Promise.reject(new Error("remove failed"))
      return Promise.resolve()
    },
  }),
}))

const { POST: tokenPost } = await import("./[slug]/token/route")
const { POST: admitPost } = await import("./[slug]/admit/route")
const { GET: docGet } = await import("./[slug]/doc/route")
const { deriveHostKey } = await import("@/lib/server/slug")

const SLUG = "1234567890" // recreatable 10-digit slug

function params(slug = SLUG) {
  return { params: Promise.resolve({ slug }) }
}

function meta(kind: ParticipantMeta["kind"]): string {
  return JSON.stringify({ kind } satisfies ParticipantMeta)
}

async function joinToken(opts: {
  identity: string
  room?: string
  kind: ParticipantMeta["kind"]
  name?: string
}): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, {
    identity: opts.identity,
    name: opts.name,
    metadata: meta(opts.kind),
    ttl: "1h",
  })
  token.addGrant({ room: opts.room ?? SLUG, roomJoin: true })
  return token.toJwt()
}

function tokenReq(body: unknown): Request {
  return new Request("http://x/api/rooms/1234567890/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function authedReq(body: unknown, token?: string): Request {
  return new Request("http://x", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.LIVEKIT_API_SECRET = API_SECRET
  process.env.MEET_ROOM_SECRET = API_SECRET
  state.rooms = []
  state.participants = []
  state.listRoomsThrows = false
  state.listParticipantsThrows = false
  state.removeThrows = false
  updateParticipant.mockClear()
  removeParticipant.mockClear()
  updateRoomMetadata.mockClear()
})

describe("token route — start gate", () => {
  it("holds a non-host at 425 for a started=false room without the host key", async () => {
    state.rooms = [{ name: SLUG, metadata: JSON.stringify({ started: false }) }]
    const res = await tokenPost(tokenReq({ displayName: "Mallory" }), params())
    expect(res.status).toBe(425)
  })

  it("lets the creator (correct host key) start the room", async () => {
    state.rooms = [{ name: SLUG, metadata: JSON.stringify({ started: false }) }]
    const res = await tokenPost(
      tokenReq({ displayName: "Host", hostKey: deriveHostKey(SLUG) }),
      params(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isHost).toBe(true)
    expect(body.waiting).toBe(false)
  })

  it("rejects a wrong host key (no start, no takeover)", async () => {
    state.rooms = [{ name: SLUG, metadata: JSON.stringify({ started: false }) }]
    const res = await tokenPost(
      tokenReq({ displayName: "Mallory", hostKey: "f".repeat(64) }),
      params(),
    )
    expect(res.status).toBe(425)
  })

  it("does not honor a removed startAnyway flag (the removed public bypass)", async () => {
    state.rooms = [{ name: SLUG, metadata: JSON.stringify({ started: false }) }]
    const res = await tokenPost(
      // startAnyway is no longer in the schema; even if sent it's ignored.
      tokenReq({ displayName: "Mallory", startAnyway: true }),
      params(),
    )
    expect(res.status).toBe(425)
  })
})

describe("token route — waiting-room bypass", () => {
  it("puts a joiner of a STARTED managed room into the waiting room even when empty", async () => {
    // The race: host flipped started=true but hasn't connected yet, so the
    // room is momentarily empty. A poller must still land in the waiting room.
    state.rooms = [{ name: SLUG, metadata: JSON.stringify({ started: true }) }]
    state.participants = []
    const res = await tokenPost(tokenReq({ displayName: "Poller" }), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.waiting).toBe(true)
    expect(body.isHost).toBe(false)
  })

  it("admits the first human directly only for a legacy room with no metadata", async () => {
    state.rooms = [{ name: SLUG, metadata: "" }]
    const res = await tokenPost(tokenReq({ displayName: "First" }), params())
    const body = await res.json()
    expect(body.waiting).toBe(false)
    expect(body.isHost).toBe(true)
  })
})

describe("token route — no roomAdmin, ever", () => {
  it("never grants roomAdmin in the issued JWT", async () => {
    state.rooms = [{ name: SLUG, metadata: "" }]
    const res = await tokenPost(tokenReq({ displayName: "First" }), params())
    const { token } = await res.json()
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    )
    expect(payload.video?.roomAdmin).toBeFalsy()
    expect(payload.video?.roomCreate).toBeFalsy()
  })
})

describe("token route — fail closed", () => {
  it("returns 503 (not direct admission) when the participant list can't be read", async () => {
    state.rooms = [{ name: SLUG, metadata: JSON.stringify({ started: true }) }]
    state.listParticipantsThrows = true
    const res = await tokenPost(tokenReq({ displayName: "X" }), params())
    expect(res.status).toBe(503)
  })
})

describe("admit route — spoofing & kick", () => {
  it("rejects an admit with no Authorization token", async () => {
    state.participants = [
      { identity: "user-waiter", metadata: meta("waiting") },
    ]
    const res = await admitPost(
      authedReq({ identity: "user-waiter", action: "admit" }),
      params(),
    )
    expect(res.status).toBe(401)
    expect(updateParticipant).not.toHaveBeenCalled()
  })

  it("rejects a caller whose verified identity isn't a live admitted human", async () => {
    // Attacker holds a valid token but is not actually connected as human.
    const token = await joinToken({ identity: "user-ghost", kind: "human" })
    state.participants = [
      { identity: "user-waiter", metadata: meta("waiting") },
    ]
    const res = await admitPost(
      authedReq({ identity: "user-waiter", action: "admit" }, token),
      params(),
    )
    expect(res.status).toBe(403)
    expect(updateParticipant).not.toHaveBeenCalled()
  })

  it("lets a verified, live admitted human admit a waiting participant", async () => {
    const token = await joinToken({ identity: "user-host", kind: "human" })
    state.participants = [
      { identity: "user-host", metadata: meta("human") },
      { identity: "user-waiter", metadata: meta("waiting") },
    ]
    const res = await admitPost(
      authedReq({ identity: "user-waiter", action: "admit" }, token),
      params(),
    )
    expect(res.status).toBe(200)
    expect(updateParticipant).toHaveBeenCalledWith(
      SLUG,
      "user-waiter",
      expect.objectContaining({ metadata: meta("human") }),
    )
  })

  it("surfaces a backend failure on deny instead of reporting success", async () => {
    const token = await joinToken({ identity: "user-host", kind: "human" })
    state.participants = [
      { identity: "user-host", metadata: meta("human") },
      { identity: "user-waiter", metadata: meta("waiting") },
    ]
    state.removeThrows = true
    const res = await admitPost(
      authedReq({ identity: "user-waiter", action: "deny" }, token),
      params(),
    )
    expect(res.status).toBe(502)
  })
})

describe("doc route — membership required", () => {
  it("rejects an unauthenticated GET", async () => {
    const res = await docGet(new Request("http://x"), params())
    expect(res.status).toBe(401)
  })

  it("rejects a waiting participant's token (not yet a member)", async () => {
    const token = await joinToken({ identity: "user-w", kind: "waiting" })
    const res = await docGet(
      new Request("http://x", {
        headers: { authorization: `Bearer ${token}` },
      }),
      params(),
    )
    expect(res.status).toBe(401)
  })
})
