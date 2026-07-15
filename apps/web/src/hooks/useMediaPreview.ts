"use client"

import { type RefObject, useCallback, useEffect, useRef, useState } from "react"

export type MediaDevice = { deviceId: string; label: string }

type UseMediaPreviewOptions = {
  audioEnabled: boolean
  videoEnabled: boolean
  audioDeviceId?: string
  videoDeviceId?: string
  videoRef: RefObject<HTMLVideoElement | null>
}

/** Acquire a camera/mic preview stream and enumerate available devices. */
export function useMediaPreview({
  audioEnabled,
  videoEnabled,
  audioDeviceId,
  videoDeviceId,
  videoRef,
}: UseMediaPreviewOptions) {
  const streamRef = useRef<MediaStream | null>(null)
  const [mics, setMics] = useState<MediaDevice[]>([])
  const [cameras, setCameras] = useState<MediaDevice[]>([])
  const [mediaError, setMediaError] = useState<string | null>(null)

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    const acquire = async () => {
      stopStream()
      setMediaError(null)
      if (!audioEnabled && !videoEnabled) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioEnabled
            ? { deviceId: audioDeviceId ? { exact: audioDeviceId } : undefined }
            : false,
          video: videoEnabled
            ? { deviceId: videoDeviceId ? { exact: videoDeviceId } : undefined }
            : false,
        })
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop()
          return
        }
        streamRef.current = stream
        if (videoRef.current && videoEnabled) {
          videoRef.current.srcObject = stream
        }
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        const toDevice = (d: MediaDeviceInfo) => ({
          deviceId: d.deviceId,
          label: d.label,
        })
        setMics(devices.filter((d) => d.kind === "audioinput").map(toDevice))
        setCameras(devices.filter((d) => d.kind === "videoinput").map(toDevice))
      } catch {
        if (!cancelled)
          setMediaError(
            "Could not access camera or microphone. Check permissions.",
          )
      }
    }
    acquire()
    return () => {
      cancelled = true
      stopStream()
    }
  }, [
    audioEnabled,
    videoEnabled,
    audioDeviceId,
    videoDeviceId,
    stopStream,
    videoRef,
  ])

  return { mics, cameras, mediaError, stopStream }
}
