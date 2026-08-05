import { useStore } from "@nanostores/react"
import { useEffect } from "react"
import { $speakerMode } from "@/stores/speakerMode"

/**
 * There's no API on iOS Safari to pick loudspeaker vs. earpiece — it doesn't
 * implement `setSinkId`, and it doesn't enumerate `audiooutput` devices for
 * a page to choose between (see SettingsPanel's DeviceSelect, which hides
 * the picker entirely for exactly that reason). The best available lever is
 * indirect: iOS's AVAudioSession routes audio to the loudspeaker by default
 * while a `<video>` element is actively playing, and favours the earpiece
 * otherwise. Keeping a silent, invisible video looping is the standard
 * workaround WebRTC-on-iOS-Safari apps use to bias the route toward the
 * speaker — not a real device selection, but the closest thing available.
 */
export function useIOSSpeakerBias() {
  const mode = useStore($speakerMode)

  useEffect(() => {
    if (mode !== "speaker") return
    if (typeof document === "undefined") return

    const canvas = document.createElement("canvas")
    canvas.width = 2
    canvas.height = 2
    const stream = (
      canvas as HTMLCanvasElement & {
        captureStream?: (fps?: number) => MediaStream
      }
    ).captureStream?.(1)
    if (!stream) return

    const video = document.createElement("video")
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.setAttribute("aria-hidden", "true")
    Object.assign(video.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
    })
    document.body.appendChild(video)
    void video.play().catch(() => {})

    return () => {
      video.pause()
      video.remove()
      for (const track of stream.getTracks()) track.stop()
    }
  }, [mode])
}
