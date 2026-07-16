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

/**
 * Watches the room for screenshare video tracks and keeps the most recent
 * frame, encoded lazily to JPEG when a turn asks for it.
 */
export class ScreenCapture {
  #room: Room
  #latest: { frame: VideoFrame; sharerName: string } | null = null
  #encoded: { at: number; result: CapturedFrame } | null = null
  #streams = new Map<string, { stop: () => void }>()

  constructor(room: Room) {
    this.#room = room
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

  get active(): boolean {
    return this.#latest !== null
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
