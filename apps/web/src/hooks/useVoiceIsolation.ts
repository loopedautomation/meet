"use client"

import { useLocalParticipant } from "@livekit/components-react"
import type { LocalAudioTrack } from "livekit-client"
import { Track } from "livekit-client"
import { useEffect } from "react"

export const VOICE_ISOLATION_PREF_KEY = "voiceIsolation"

/**
 * Enhanced voice isolation — a stronger, ML-based version of the browser's
 * built-in noise suppression, where the browser supports it (Chromium-based
 * for now; ignored elsewhere). On by default: it's a strict upgrade on the
 * usual DSP, so the absence of the key (never toggled) reads as enabled.
 */
export function readVoiceIsolationPref(): boolean {
  if (typeof window === "undefined") return true
  try {
    return localStorage.getItem(VOICE_ISOLATION_PREF_KEY) !== "false"
  } catch {
    return true
  }
}

export function writeVoiceIsolationPref(enabled: boolean) {
  try {
    localStorage.setItem(VOICE_ISOLATION_PREF_KEY, String(enabled))
  } catch {}
}

/** Whether the browser exposes the (experimental) voiceIsolation constraint. */
export function supportsVoiceIsolation(): boolean {
  if (typeof navigator === "undefined") return false
  try {
    const supported = navigator.mediaDevices.getSupportedConstraints() as {
      voiceIsolation?: boolean
    }
    return Boolean(supported.voiceIsolation)
  } catch {
    return false
  }
}

/**
 * Keep the local microphone track in line with the voice-isolation preference.
 * The room's audioCaptureDefaults already apply it at capture time, so on join
 * and unmute the fresh track is usually correct and this is a no-op; it only
 * re-acquires the mic when the applied setting no longer matches — i.e. the
 * user flipped the toggle while the mic was live. The current device is carried
 * over so the restart doesn't fall back to the default input.
 */
export function useVoiceIsolation(enabled: boolean) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()

  useEffect(() => {
    if (!supportsVoiceIsolation()) return
    const pub = localParticipant.getTrackPublication(Track.Source.Microphone)
    const track = pub?.track as LocalAudioTrack | undefined
    if (!track) return
    // Re-acquiring getUserMedia drops a beat of audio, so only pay it when the
    // live setting actually differs from what the user wants.
    const settings = track.mediaStreamTrack.getSettings() as {
      voiceIsolation?: boolean
      deviceId?: string
    }
    if (settings.voiceIsolation === enabled) return
    let cancelled = false
    void (async () => {
      try {
        if (cancelled) return
        await track.restartTrack({
          deviceId: settings.deviceId,
          voiceIsolation: enabled,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        })
      } catch {
        // Unsupported constraint or a busy device — audio continues unchanged.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, isMicrophoneEnabled, localParticipant])
}
