"use client"

import { useLocalParticipant } from "@livekit/components-react"
import {
  SELF_TRANSCRIBE_ACTIVE,
  SELF_TRANSCRIBE_ATTRIBUTE,
  TRANSCRIPTION_TOPIC,
  tidyShoutyTranscript,
} from "@meet/shared"
import { Track } from "livekit-client"
import { useEffect } from "react"
import { upsertLocalSegment } from "@/stores/localTranscript"

export const LOCAL_STT_PREF_KEY = "localStt"

export function readLocalSttPref(): boolean {
  if (typeof window === "undefined") return false
  try {
    // Default on when deployed with models; users can opt out.
    return localStorage.getItem(LOCAL_STT_PREF_KEY) !== "false"
  } catch {
    return true
  }
}

export function writeLocalSttPref(enabled: boolean) {
  try {
    localStorage.setItem(LOCAL_STT_PREF_KEY, String(enabled))
  } catch {}
}

const INTERIM_INTERVAL_MS = 300
// First load pulls ~200 MB of model into the browser cache; the server
// transcribes meanwhile, so a long deadline costs nothing.
const INIT_TIMEOUT_MS = 180_000
const WATCHDOG_MS = 5_000

/**
 * In-browser transcription of the local mic via a WASM streaming recognizer.
 *
 * Strictly opportunistic: the server transcriber covers this participant
 * until the engine is loaded and decoding, at which point we advertise
 * SELF_TRANSCRIBE_ATTRIBUTE and the server hands the track off. Any failure
 * (assets missing, load timeout, worker crash, stalled decoding) tears down
 * and clears the attribute so the server resumes — local STT never blocks.
 */
export function useLocalTranscription(enabled: boolean) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!enabled || !isMicrophoneEnabled) return
    if (
      typeof Worker === "undefined" ||
      typeof WebAssembly === "undefined" ||
      typeof AudioWorkletNode === "undefined"
    ) {
      return
    }
    const pub = localParticipant.getTrackPublication(Track.Source.Microphone)
    const mediaTrack = pub?.track?.mediaStreamTrack
    if (!mediaTrack) return
    const trackSid = pub?.trackSid ?? ""

    let cancelled = false
    let worker: Worker | null = null
    let audioCtx: AudioContext | null = null
    let active = false
    let lastAlive = 0
    let framesSent = false
    let watchdog: ReturnType<typeof setInterval> | null = null
    let initTimer: ReturnType<typeof setTimeout> | null = null

    let nextSegment = 0
    let segmentId = ""
    let lastInterimAt = 0
    let lastInterimText = ""

    const newSegmentId = () => {
      segmentId = `seg-local-${localParticipant.identity}-${nextSegment++}`
    }

    const publish = async (text: string, final: boolean) => {
      // Text streams don't loop back to the sender — mirror our own segments
      // into the local store so our transcript panel shows them too.
      upsertLocalSegment({
        id: segmentId,
        identity: localParticipant.identity,
        text,
        final,
        at: Date.now(),
      })
      try {
        const writer = await localParticipant.streamText({
          topic: TRANSCRIPTION_TOPIC,
          attributes: {
            "lk.transcribed_track_id": trackSid,
            "lk.segment_id": segmentId,
            "lk.transcription_final": String(final),
          },
        })
        await writer.write(text)
        await writer.close()
      } catch {
        // room closing or stream failure; the segment is simply lost
      }
    }

    const setAttr = (value: string) => {
      // Empty string deletes the attribute server-side.
      void localParticipant
        .setAttributes({ [SELF_TRANSCRIBE_ATTRIBUTE]: value })
        .catch(() => {})
    }

    const teardown = () => {
      if (watchdog) clearInterval(watchdog)
      if (initTimer) clearTimeout(initTimer)
      watchdog = null
      initTimer = null
      worker?.terminate()
      worker = null
      void audioCtx?.close().catch(() => {})
      audioCtx = null
      if (active) {
        active = false
        setAttr("")
      }
    }

    void (async () => {
      // Deployment may not ship models; probe before spinning anything up.
      try {
        const head = await fetch("/stt/sherpa-onnx-wasm-main-asr.js", {
          method: "HEAD",
        })
        if (!head.ok) return
      } catch {
        return
      }
      if (cancelled) return

      worker = new Worker("/stt/stt-worker.js")
      newSegmentId()

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as {
          type: string
          text?: string
          final?: boolean
          message?: string
        }
        if (msg.type === "ready") {
          if (initTimer) clearTimeout(initTimer)
          // Engine is up and decoding locally — claim the track from the
          // server transcriber.
          active = true
          lastAlive = Date.now()
          setAttr(SELF_TRANSCRIBE_ACTIVE)
          return
        }
        if (msg.type === "alive") {
          lastAlive = Date.now()
          return
        }
        if (msg.type === "error") {
          console.warn(`local STT failed, using server: ${msg.message}`)
          teardown()
          return
        }
        if (msg.type === "segment" && msg.text) {
          const text = tidyShoutyTranscript(msg.text)
          if (msg.final) {
            void publish(text, true)
            newSegmentId()
            lastInterimText = ""
            return
          }
          const now = Date.now()
          if (
            text !== lastInterimText &&
            now - lastInterimAt > INTERIM_INTERVAL_MS
          ) {
            lastInterimAt = now
            lastInterimText = text
            void publish(text, false)
          }
        }
      }
      worker.onerror = () => teardown()
      worker.postMessage({ type: "init" })
      initTimer = setTimeout(() => {
        if (!active) teardown()
      }, INIT_TIMEOUT_MS)

      try {
        audioCtx = new AudioContext()
        // Autoplay policy can start the context suspended even post-join.
        if (audioCtx.state === "suspended") await audioCtx.resume()
        await audioCtx.audioWorklet.addModule("/stt/pcm-worklet.js")
        if (cancelled) return teardown()
        const source = audioCtx.createMediaStreamSource(
          new MediaStream([mediaTrack]),
        )
        const node = new AudioWorkletNode(audioCtx, "pcm-worklet")
        node.port.onmessage = (e: MessageEvent) => {
          const { samples } = e.data as { samples: Float32Array }
          framesSent = true
          worker?.postMessage({ type: "frames", samples }, [
            samples.buffer as ArrayBuffer,
          ])
        }
        source.connect(node)
        // Worklets need a sink in some browsers; keep it silent.
        const sink = audioCtx.createGain()
        sink.gain.value = 0
        node.connect(sink)
        sink.connect(audioCtx.destination)
      } catch (err) {
        console.warn(`local STT audio tap failed, using server: ${err}`)
        return teardown()
      }

      // If we're feeding audio but the worker stops responding, assume the
      // engine died and hand back to the server.
      watchdog = setInterval(() => {
        if (!active || !framesSent) return
        if (Date.now() - lastAlive > WATCHDOG_MS) {
          console.warn("local STT stalled, falling back to server")
          teardown()
        }
      }, 1000)
    })()

    return () => {
      cancelled = true
      teardown()
    }
  }, [enabled, isMicrophoneEnabled, localParticipant])
}
