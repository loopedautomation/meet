import { SELF_TRANSCRIBE_ACTIVE, SELF_TRANSCRIBE_ATTRIBUTE } from "@meet/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

// The worker drives everything through the rtc-node room/AudioStream FFI;
// replace both with controllable fakes so entry() runs in-process.
const audioStreams: FakeAudioStream[] = []

class FakeAudioStream {
  cancelled = false
  private pendingRead: ((r: { value?: unknown; done: boolean }) => void)[] = []
  constructor(public track: { sid: string }) {
    audioStreams.push(this)
  }
  getReader() {
    return {
      read: () =>
        new Promise<{ value?: unknown; done: boolean }>((resolve) => {
          if (this.cancelled) resolve({ done: true })
          else this.pendingRead.push(resolve)
        }),
      cancel: async () => {
        this.cancelled = true
        for (const r of this.pendingRead) r({ done: true })
        this.pendingRead = []
      },
    }
  }
}

vi.mock("@livekit/rtc-node", () => ({
  AudioStream: FakeAudioStream,
  TrackKind: { KIND_AUDIO: 1 },
}))

const postTranscriptSegment = vi.fn()
vi.mock("./meeting-context.js", () => ({
  postDebugEvent: vi.fn(),
  postTranscriptSegment: (...args: unknown[]) => postTranscriptSegment(...args),
}))

// Import after mocks are registered.
const agent = (await import("./transcriber-worker.js")).default

type Handler = (...args: unknown[]) => void

function makeTrack(sid: string) {
  return { kind: 1, sid }
}

function makeParticipant(
  identity: string,
  opts: { kind?: string; attributes?: Record<string, string> } = {},
) {
  const track = makeTrack(`trk-${identity}`)
  return {
    identity,
    name: identity,
    metadata: JSON.stringify({ kind: opts.kind ?? "human" }),
    attributes: opts.attributes ?? {},
    trackPublications: new Map([[track.sid, { sid: track.sid, track }]]),
    track,
  }
}

function makeRoom() {
  const handlers = new Map<string, Handler>()
  let textHandler:
    | ((
        reader: {
          info: { attributes?: Record<string, string> }
          readAll: () => Promise<string>
        },
        info: { identity: string },
      ) => void)
    | null = null
  return {
    name: "room1",
    remoteParticipants: new Map<string, ReturnType<typeof makeParticipant>>(),
    localParticipant: {
      streamText: async () => ({
        write: async () => {},
        close: async () => {},
      }),
    },
    on(event: string, handler: Handler) {
      handlers.set(event, handler)
    },
    emit(event: string, ...args: unknown[]) {
      handlers.get(event)?.(...args)
    },
    registerTextStreamHandler(_topic: string, cb: typeof textHandler) {
      textHandler = cb
    },
    get textStreamHandler() {
      return textHandler
    },
  }
}

const fakeEngine = {
  createStream: () => ({
    accept: () => {},
    text: () => "",
    endpoint: () => false,
    reset: () => {},
    free: () => {},
  }),
}

async function startWorker(room: ReturnType<typeof makeRoom>) {
  const ctx = {
    proc: {
      userData: {
        stt: fakeEngine,
        denoiser: null,
        finalizerLoading: Promise.resolve(null),
      },
    },
    job: { room: { name: room.name } },
    connect: async () => {},
    room,
  }
  await agent.entry(ctx as never)
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  audioStreams.length = 0
  postTranscriptSegment.mockClear()
})

describe("transcriber handoff", () => {
  it("transcribes humans but skips agents and self-transcribing clients", async () => {
    const room = makeRoom()
    const alice = makeParticipant("alice")
    const agentP = makeParticipant("scout", { kind: "agent" })
    const bob = makeParticipant("bob", {
      attributes: { [SELF_TRANSCRIBE_ATTRIBUTE]: SELF_TRANSCRIBE_ACTIVE },
    })
    for (const p of [alice, agentP, bob]) {
      room.remoteParticipants.set(p.identity, p)
    }
    await startWorker(room)
    expect(audioStreams.map((s) => s.track.sid)).toEqual(["trk-alice"])
  })

  it("pauses server STT when a client turns self-transcription on, resumes when it clears", async () => {
    const room = makeRoom()
    const alice = makeParticipant("alice")
    room.remoteParticipants.set("alice", alice)
    await startWorker(room)
    expect(audioStreams).toHaveLength(1)

    alice.attributes[SELF_TRANSCRIBE_ATTRIBUTE] = SELF_TRANSCRIBE_ACTIVE
    room.emit(
      "participantAttributesChanged",
      { [SELF_TRANSCRIBE_ATTRIBUTE]: SELF_TRANSCRIBE_ACTIVE },
      alice,
    )
    await tick()
    expect(audioStreams[0].cancelled).toBe(true)

    // Client's engine died — attribute clears, server reclaims the track.
    alice.attributes[SELF_TRANSCRIBE_ATTRIBUTE] = ""
    room.emit(
      "participantAttributesChanged",
      { [SELF_TRANSCRIBE_ATTRIBUTE]: "" },
      alice,
    )
    await tick()
    expect(audioStreams).toHaveLength(2)
    expect(audioStreams[1].track.sid).toBe("trk-alice")
    expect(audioStreams[1].cancelled).toBe(false)
  })

  it("stops loops when the participant disconnects and does not double-start a running track", async () => {
    const room = makeRoom()
    const alice = makeParticipant("alice")
    room.remoteParticipants.set("alice", alice)
    await startWorker(room)

    // A repeat subscribe for a track that is already transcribing is a no-op.
    room.emit("trackSubscribed", alice.track, { sid: alice.track.sid }, alice)
    expect(audioStreams).toHaveLength(1)

    room.emit("participantDisconnected", alice)
    await tick()
    expect(audioStreams[0].cancelled).toBe(true)
  })

  it("mirrors self-transcribing clients' finals into the transcript store", async () => {
    const room = makeRoom()
    const bob = makeParticipant("bob", {
      attributes: { [SELF_TRANSCRIBE_ATTRIBUTE]: SELF_TRANSCRIBE_ACTIVE },
    })
    room.remoteParticipants.set("bob", bob)
    await startWorker(room)
    const handler = room.textStreamHandler
    expect(handler).toBeTruthy()

    handler?.(
      {
        info: { attributes: { "lk.transcription_final": "true" } },
        readAll: async () => "hello from the browser",
      },
      { identity: "bob" },
    )
    await tick()
    expect(postTranscriptSegment).toHaveBeenCalledWith(
      "room1",
      expect.objectContaining({
        speaker: "bob",
        text: "hello from the browser",
      }),
    )
  })

  it("ignores interims and finals from non-self-transcribing senders", async () => {
    const room = makeRoom()
    const alice = makeParticipant("alice") // server-transcribed
    room.remoteParticipants.set("alice", alice)
    await startWorker(room)
    const handler = room.textStreamHandler

    // Interim from anyone: dropped.
    handler?.(
      {
        info: { attributes: { "lk.transcription_final": "false" } },
        readAll: async () => "typing…",
      },
      { identity: "alice" },
    )
    // Final from a server-transcribed participant (the server already posted
    // it): dropped, no double-store.
    handler?.(
      {
        info: { attributes: { "lk.transcription_final": "true" } },
        readAll: async () => "server already stored this",
      },
      { identity: "alice" },
    )
    await tick()
    expect(postTranscriptSegment).not.toHaveBeenCalled()
  })
})
