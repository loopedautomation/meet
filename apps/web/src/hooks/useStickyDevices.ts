"use client"

import { useRoomContext } from "@livekit/components-react"
import { useStore } from "@nanostores/react"
import { RoomEvent } from "livekit-client"
import { useEffect } from "react"
import {
  $audioDeviceId,
  $videoDeviceId,
  isPinnedDevice,
} from "@/stores/devicePrefs"

type InputKind = "audioinput" | "videoinput"

/**
 * Hold the user's chosen input devices against LiveKit's auto-switching.
 *
 * On every OS `devicechange`, LiveKit's Room runs selectDefaultDevices() and,
 * for a participant it treats as being "on the default device", follows the OS
 * by switching to the new default input. With nothing pinned that's the app's
 * state, so plugging in headphones silently moves you off the microphone you
 * picked. When a concrete device is pinned and still connected, re-assert it
 * whenever the active device drifts away. A pin of "" / "default" means "follow
 * the system default", so those are left alone.
 *
 * Mount once inside the room (LiveKit context required).
 */
export function useStickyDevices() {
  const room = useRoomContext()
  const audioPin = useStore($audioDeviceId)
  const videoPin = useStore($videoDeviceId)

  useEffect(() => {
    const pins: Record<InputKind, string> = {
      audioinput: audioPin,
      videoinput: videoPin,
    }

    const reassert = async (kind: InputKind) => {
      const want = pins[kind]
      if (!isPinnedDevice(want)) return
      if (room.getActiveDevice(kind) === want) return
      // Only force the pin back when the device is actually still present — a
      // pinned input that was unplugged should fall back gracefully and snap
      // back on its own once it returns and fires the next change.
      const present = (
        await navigator.mediaDevices.enumerateDevices().catch(() => [])
      ).some((d) => d.kind === kind && d.deviceId === want)
      if (!present) return
      // switchActiveDevice re-emits ActiveDeviceChanged with `want`, which lands
      // back here and no-ops (active === want), so this settles rather than loops.
      await room.switchActiveDevice(kind, want).catch(() => undefined)
    }

    const onActiveDeviceChanged = (kind: MediaDeviceKind) => {
      if (kind === "audioinput" || kind === "videoinput") void reassert(kind)
    }
    const onDevicesChanged = () => {
      void reassert("audioinput")
      void reassert("videoinput")
    }

    room.on(RoomEvent.ActiveDeviceChanged, onActiveDeviceChanged)
    room.on(RoomEvent.MediaDevicesChanged, onDevicesChanged)
    // Assert once on mount too, in case a device shifted before we subscribed
    // (e.g. LiveKit followed the OS default during the waiting room).
    void reassert("audioinput")
    void reassert("videoinput")
    return () => {
      room.off(RoomEvent.ActiveDeviceChanged, onActiveDeviceChanged)
      room.off(RoomEvent.MediaDevicesChanged, onDevicesChanged)
    }
  }, [room, audioPin, videoPin])
}
