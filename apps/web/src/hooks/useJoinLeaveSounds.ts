"use client"

import { useRoomContext } from "@livekit/components-react"
import { isServiceParticipant } from "@meet/shared"
import { type RemoteParticipant, RoomEvent } from "livekit-client"
import { useEffect, useRef } from "react"

/**
 * Play a short two-note chime when a participant joins (rising) or leaves
 * (falling). Synthesized with WebAudio so no audio assets are needed.
 */
export function useJoinLeaveSounds() {
  const room = useRoomContext()
  const ctxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    const chime = (direction: "join" | "leave") => {
      try {
        ctxRef.current ??= new AudioContext()
        const ctx = ctxRef.current
        // Autoplay policy can leave the context suspended; joining a room
        // required a user gesture, so resume succeeds.
        if (ctx.state === "suspended") void ctx.resume()
        const notes = direction === "join" ? [523.25, 783.99] : [783.99, 523.25]
        notes.forEach((freq, i) => {
          const start = ctx.currentTime + i * 0.12
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = "sine"
          osc.frequency.value = freq
          gain.gain.setValueAtTime(0, start)
          gain.gain.linearRampToValueAtTime(0.08, start + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3)
          osc.connect(gain).connect(ctx.destination)
          osc.start(start)
          osc.stop(start + 0.35)
        })
      } catch {
        // No audio? The meeting works fine without chimes.
      }
    }

    const onJoin = (p: RemoteParticipant) => {
      if (!isServiceParticipant(p.metadata)) chime("join")
    }
    const onLeave = (p: RemoteParticipant) => {
      if (!isServiceParticipant(p.metadata)) chime("leave")
    }
    room.on(RoomEvent.ParticipantConnected, onJoin)
    room.on(RoomEvent.ParticipantDisconnected, onLeave)
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin)
      room.off(RoomEvent.ParticipantDisconnected, onLeave)
    }
  }, [room])

  useEffect(
    () => () => {
      ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
    },
    [],
  )
}
