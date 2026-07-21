import {
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
  TrackKind,
  TrackSource,
  VideoBufferType,
  type VideoFrame,
  VideoStream,
} from "@livekit/rtc-node"
import sharp from "sharp"

const MAX_WIDTH = 1280
const JPEG_QUALITY = 70
/** Don't re-encode more than once per second even if turns are frequent. */
const ENCODE_INTERVAL_MS = 1000

export type CapturedFrame = {
  mediaType: "image/jpeg"
  data: string
  sharerName: string
}

/** An image as the brain's TTY protocol carries it. */
export type BrainImage = { mediaType: string; data: string }

/**
 * Whether agents may look at shared screens at all. A meeting where the
 * agent silently reads every frame of whatever you share is not one people
 * can consent to by default in every deployment, so it's one env var to turn
 * off — `AGENT_SCREEN_VISION=off` — and the web UI tells sharers which way
 * it's set rather than leaving it to the operator to remember.
 */
export function screenVisionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = env.AGENT_SCREEN_VISION?.trim().toLowerCase()
  return flag !== "off" && flag !== "false" && flag !== "0"
}

/**
 * Attaches the current screenshare frame to a turn, if there is one.
 *
 * Every path that talks to the brain — voice turn, chat reply, realtime
 * delegation — needs the same two things done identically: the image on the
 * message, and a line of text telling the model the image is there and whose
 * screen it is. Three hand-rolled copies of that had already drifted apart.
 */
export async function attachScreenFrame(
  screen: ScreenCapture | null | undefined,
  text: string,
): Promise<{ text: string; images?: BrainImage[] }> {
  const capture = screen?.active
    ? await screen.latestJpeg().catch(() => null)
    : null
  if (!capture) return { text }
  return {
    text: `[A current frame of ${capture.sharerName}'s shared screen is attached.]\n${text}`,
    images: [{ mediaType: capture.mediaType, data: capture.data }],
  }
}

/**
 * Watches the room for screenshare video tracks and keeps the most recent
 * frame, encoded lazily to JPEG when a turn asks for it.
 */
export class ScreenCapture {
  #room: Room
  #latest: { frame: VideoFrame; sharerName: string } | null = null
  #encoded: { at: number; result: CapturedFrame } | null = null
  #streams = new Map<string, { stop: () => void }>()
  readonly #enabled: boolean

  constructor(room: Room, enabled = screenVisionEnabled()) {
    this.#room = room
    this.#enabled = enabled
    if (!enabled) return
    room.on(
      "trackSubscribed",
      (track: RemoteTrack, pub: RemoteTrackPublication, participant) => {
        if (
          track.kind === TrackKind.KIND_VIDEO &&
          pub.source === TrackSource.SOURCE_SCREENSHARE
        ) {
          this.#watch(track, participant.name || participant.identity)
        }
      },
    )
    room.on("trackUnsubscribed", (track: RemoteTrack) => {
      const watcher = this.#streams.get(track.sid ?? "")
      if (watcher) {
        watcher.stop()
        this.#streams.delete(track.sid ?? "")
        this.#latest = null
        this.#encoded = null
      }
    })
  }

  /** True when a screenshare is running and agents are allowed to see it. */
  get active(): boolean {
    return this.#enabled && this.#latest !== null
  }

  /** Whether this deployment lets agents look at shared screens at all. */
  get enabled(): boolean {
    return this.#enabled
  }

  /** Who is sharing right now, for telling the agent what it could look at. */
  get sharerName(): string | null {
    return this.active ? (this.#latest?.sharerName ?? null) : null
  }

  #watch(track: RemoteTrack, sharerName: string) {
    const stream = new VideoStream(track)
    let stopped = false
    const run = async () => {
      for await (const event of stream) {
        if (stopped) break
        this.#latest = { frame: event.frame, sharerName }
      }
    }
    run().catch(() => undefined)
    this.#streams.set(track.sid ?? "", {
      stop: () => {
        stopped = true
        stream.cancel().catch(() => undefined)
      },
    })
  }

  /** The most recent screenshare frame as JPEG, or null when nobody shares. */
  async latestJpeg(): Promise<CapturedFrame | null> {
    if (!this.#enabled) return null
    const latest = this.#latest
    if (!latest) return null
    if (this.#encoded && Date.now() - this.#encoded.at < ENCODE_INTERVAL_MS) {
      return this.#encoded.result
    }
    const rgba = latest.frame.convert(VideoBufferType.RGBA)
    const width = rgba.width
    const height = rgba.height
    let pipeline = sharp(Buffer.from(rgba.data.buffer, 0, width * height * 4), {
      raw: { width, height, channels: 4 },
    })
    if (width > MAX_WIDTH) pipeline = pipeline.resize({ width: MAX_WIDTH })
    const jpeg = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer()
    const result: CapturedFrame = {
      mediaType: "image/jpeg",
      data: jpeg.toString("base64"),
      sharerName: latest.sharerName,
    }
    this.#encoded = { at: Date.now(), result }
    return result
  }
}
