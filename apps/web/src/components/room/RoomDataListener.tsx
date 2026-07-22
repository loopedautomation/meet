"use client"

import { useDataChannel, useRoomContext } from "@livekit/components-react"
import {
  agentActivityEventSchema,
  chatMessageSchema,
  DataTopic,
  docPresenceSchema,
  sharedDocSchema,
} from "@meet/shared"
import { RoomEvent } from "livekit-client"
import { useEffect } from "react"
import { applyDocUpdate, resetDoc } from "@/stores/doc"
import {
  removeDocPresence,
  resetDocPresence,
  upsertDocPresence,
} from "@/stores/docPresence"
import {
  addAgentActivity,
  addChatMessage,
  resetRoomData,
} from "@/stores/roomData"

/** Always-mounted subscriber: chat and agent activity survive panel toggling. */
export function RoomDataListener({ slug }: { slug: string }) {
  const room = useRoomContext()
  useDataChannel(DataTopic.Chat, (msg) => {
    try {
      const parsed = chatMessageSchema.safeParse(
        JSON.parse(new TextDecoder().decode(msg.payload)),
      )
      if (parsed.success) addChatMessage(parsed.data)
    } catch {}
  })

  useDataChannel(DataTopic.AgentActivity, (msg) => {
    try {
      const parsed = agentActivityEventSchema.safeParse(
        JSON.parse(new TextDecoder().decode(msg.payload)),
      )
      if (parsed.success) addAgentActivity(parsed.data)
    } catch {}
  })

  useDataChannel(DataTopic.Doc, (msg) => {
    try {
      const parsed = sharedDocSchema.safeParse(
        JSON.parse(new TextDecoder().decode(msg.payload)),
      )
      if (parsed.success) applyDocUpdate(parsed.data)
    } catch {}
  })

  useDataChannel(DataTopic.DocPresence, (msg) => {
    try {
      const parsed = docPresenceSchema.safeParse(
        JSON.parse(new TextDecoder().decode(msg.payload)),
      )
      if (!parsed.success) return
      if (parsed.data.start === null || parsed.data.end === null) {
        removeDocPresence(parsed.data.by)
      } else {
        upsertDocPresence(parsed.data)
      }
    } catch {}
  })

  // A dropped connection never sends a "left the editor" message, so the
  // cursor is cleared when the participant itself goes away.
  useEffect(() => {
    const onLeave = (participant: { identity: string }) =>
      removeDocPresence(participant.identity)
    room.on(RoomEvent.ParticipantDisconnected, onLeave)
    return () => {
      room.off(RoomEvent.ParticipantDisconnected, onLeave)
    }
  }, [room])

  // Data messages only reach people already in the room, so the document has
  // to be fetched once on arrival — otherwise everyone who joins after the
  // first line was written sees a blank page until somebody types.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/rooms/${slug}/doc`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return
        const parsed = sharedDocSchema.safeParse(body.doc)
        if (parsed.success) applyDocUpdate(parsed.data)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(
    () => () => {
      resetRoomData()
      resetDoc()
      resetDocPresence()
    },
    [],
  )

  return null
}
