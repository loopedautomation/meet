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
import { roomAuthHeaders } from "@/lib/roomAuth"
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
      if (!parsed.success) return
      // The payload's claimed sender is replaced with the actual LiveKit
      // sender — anyone can type any name into a crafted data message.
      addChatMessage(
        msg.from
          ? {
              ...parsed.data,
              from: msg.from.identity,
              fromName: msg.from.name || msg.from.identity,
            }
          : parsed.data,
      )
    } catch {}
  })

  useDataChannel(DataTopic.AgentActivity, (msg) => {
    try {
      // Only the bridge's agent participants publish activity; a human
      // crafting activity packets must not be able to fake agent behavior.
      if (!msg.from || !msg.from.identity.startsWith("agent-")) return
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
      if (!parsed.success) return
      // Attribution follows the actual LiveKit sender, not payload claims.
      applyDocUpdate(
        msg.from
          ? {
              ...parsed.data,
              by: msg.from.identity,
              byName: msg.from.name || msg.from.identity,
            }
          : parsed.data,
      )
    } catch {}
  })

  useDataChannel(DataTopic.DocPresence, (msg) => {
    try {
      const parsed = docPresenceSchema.safeParse(
        JSON.parse(new TextDecoder().decode(msg.payload)),
      )
      if (!parsed.success) return
      // Keyed by the actual LiveKit sender, so nobody can move or clear
      // someone else's cursor with a crafted message.
      const presence = msg.from
        ? {
            ...parsed.data,
            by: msg.from.identity,
            byName: msg.from.name || msg.from.identity,
          }
        : parsed.data
      if (presence.start === null || presence.end === null) {
        removeDocPresence(presence.by)
      } else {
        upsertDocPresence(presence)
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
    fetch(`/api/rooms/${slug}/doc`, { headers: roomAuthHeaders(slug) })
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
