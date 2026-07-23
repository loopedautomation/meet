"use client"

import { useDataChannel, useRoomContext } from "@livekit/components-react"
import {
  agentActivityEventSchema,
  canvasConvertRequestSchema,
  canvasDiffSchema,
  canvasSnapshotSchema,
  chatMessageSchema,
  chatOpSchema,
  DataTopic,
  docPresenceSchema,
  docSyncMessageSchema,
  parseParticipantMeta,
  TYPING_STALE_MS,
} from "@meet/shared"
import { RoomEvent } from "livekit-client"
import { useEffect } from "react"
import { toast } from "react-toastify"
import { roomAuthHeaders } from "@/lib/roomAuth"
import {
  $canvasOpen,
  $canvasUnseen,
  applyCanvasChanges,
  noteAgentDrawing,
  resetCanvas,
} from "@/stores/canvas"
import { $doc, applyRemoteDocUpdate, resetDoc } from "@/stores/doc"
import {
  removeDocPresence,
  resetDocPresence,
  upsertDocPresence,
} from "@/stores/docPresence"
import {
  addAgentActivity,
  addChatMessage,
  clearAgentTyping,
  pruneTypingAgents,
  removeChatMessage,
  resetRoomData,
  setAgentTyping,
  updateChatMessage,
} from "@/stores/roomData"

/** Always-mounted subscriber: chat and agent activity survive panel toggling. */
export function RoomDataListener({ slug }: { slug: string }) {
  const room = useRoomContext()

  useDataChannel(DataTopic.Chat, (msg) => {
    try {
      const raw = JSON.parse(new TextDecoder().decode(msg.payload))

      const parsed = chatMessageSchema.safeParse(raw)
      if (parsed.success) {
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
        // The message landing is itself the end of composing, so clear any
        // lingering "typing…" for its sender even if the stop signal is in flight.
        if (msg.from) clearAgentTyping(msg.from.identity)
        return
      }

      // Not a new message — check whether it's an edit/delete op instead.
      // Same rule as above: the op is only honored against the actual
      // LiveKit sender, checked inside the store against the original
      // message's author, never against whatever the payload claims.
      if (!msg.from) return
      const op = chatOpSchema.safeParse(raw)
      if (!op.success) return
      const by = msg.from.identity
      if (op.data.op === "edit") {
        updateChatMessage(op.data.id, by, op.data.text, op.data.at)
      } else {
        removeChatMessage(op.data.id, by)
      }
    } catch {}
  })

  useDataChannel(DataTopic.AgentActivity, (msg) => {
    try {
      if (!msg.from) return
      const parsed = agentActivityEventSchema.safeParse(
        JSON.parse(new TextDecoder().decode(msg.payload)),
      )
      if (!parsed.success) return
      // Typing is transient presence keyed by the real sender, not a logged
      // step — route it to the indicator rather than the activity feed.
      // Unlike the feed below it's open to humans too: composing in the
      // chat is presence anyone may claim about themselves, and the
      // attribution is the verified sender either way.
      if (parsed.data.type === "typing") {
        setAgentTyping(
          msg.from.identity,
          msg.from.name || msg.from.identity,
          parsed.data.typing,
          parsed.data.at,
        )
        return
      }
      // Only the bridge's agent participants publish real activity; a human
      // crafting activity packets must not be able to fake agent behavior.
      if (!msg.from.identity.startsWith("agent-")) return
      addAgentActivity(parsed.data)
    } catch {}
  })

  // The bridge has no browser, and rendering Mermaid properly needs one.
  // It addresses ONE client (destinationIdentities — only that client even
  // receives the message, so there is no election and no race) and that
  // client runs the official mermaid-to-excalidraw converter, streaming the
  // element JSON back in chunks under the data channel's size cap.
  const { send: sendConvert } = useDataChannel(
    DataTopic.CanvasConvert,
    (msg) => {
      if (!msg.from?.identity.startsWith("agent-")) return
      const requester = msg.from.identity
      try {
        const parsed = canvasConvertRequestSchema.safeParse(
          JSON.parse(new TextDecoder().decode(msg.payload)),
        )
        if (!parsed.success) return
        const request = parsed.data
        void (async () => {
          const reply = (payload: Record<string, unknown>) =>
            sendConvert(new TextEncoder().encode(JSON.stringify(payload)), {
              topic: DataTopic.CanvasConvert,
              reliable: true,
              destinationIdentities: [requester],
            })
          try {
            // Lazy: mermaid is a heavy chunk nobody pays for until an agent
            // actually draws a diagram.
            const [
              { parseMermaidToExcalidraw },
              { convertToExcalidrawElements },
            ] = await Promise.all([
              import("@excalidraw/mermaid-to-excalidraw"),
              import("@excalidraw/excalidraw"),
            ])
            const { elements } = await parseMermaidToExcalidraw(request.mermaid)
            // biome-ignore lint/suspicious/noExplicitAny: opaque skeleton JSON
            const full = convertToExcalidrawElements(elements as any)
            const json = JSON.stringify(full)
            const CHUNK = 10_000
            const total = Math.max(1, Math.ceil(json.length / CHUNK))
            for (let seq = 0; seq < total; seq++) {
              await reply({
                type: "canvas-convert-result",
                id: request.id,
                seq,
                total,
                part: json.slice(seq * CHUNK, (seq + 1) * CHUNK),
              })
            }
          } catch (err) {
            await reply({
              type: "canvas-convert-error",
              id: request.id,
              error: ((err as Error).message || "conversion failed").slice(
                0,
                480,
              ),
            })
          }
        })()
      } catch {}
    },
  )

  useDataChannel(DataTopic.Doc, (msg) => {
    try {
      const parsed = docSyncMessageSchema.safeParse(
        JSON.parse(new TextDecoder().decode(msg.payload)),
      )
      if (!parsed.success) return
      if (!applyRemoteDocUpdate(parsed.data.update)) return
      // Attribution follows the actual LiveKit sender, not payload claims —
      // shown as "last edited by", while the text itself merged above.
      if (msg.from) {
        $doc.set({
          ...$doc.get(),
          by: msg.from.identity,
          byName: msg.from.name || msg.from.identity,
        })
      }
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

  useDataChannel(DataTopic.Canvas, (msg) => {
    try {
      const parsed = canvasDiffSchema.safeParse(
        JSON.parse(new TextDecoder().decode(msg.payload)),
      )
      if (!parsed.success) return
      // The actual LiveKit sender outranks the payload's claimed one, same
      // as chat. Own broadcasts already went through the local cache.
      const sender = msg.from?.identity ?? parsed.data.from
      if (sender === room.localParticipant.identity) return
      const won = applyCanvasChanges(parsed.data.changes)
      if (won.length === 0) return
      const fromAgent = msg.from
        ? parseParticipantMeta(msg.from.metadata)?.kind === "agent"
        : parsed.data.from.startsWith("agent-")
      const senderName = msg.from
        ? msg.from.name || msg.from.identity
        : parsed.data.fromName
      if (fromAgent) noteAgentDrawing(senderName)
      if (!$canvasOpen.get()) {
        $canvasUnseen.set(true)
        if (fromAgent) {
          toast.info(`${senderName} is drawing on the whiteboard`, {
            toastId: "canvas-agent-drawing",
            onClick: () => {
              $canvasOpen.set(true)
              $canvasUnseen.set(false)
            },
          })
        }
      }
    } catch {}
  })

  // A dropped connection never sends a "left the editor" message, so the
  // cursor and any "typing…" are cleared when the participant itself goes away.
  useEffect(() => {
    const onLeave = (participant: { identity: string }) => {
      removeDocPresence(participant.identity)
      clearAgentTyping(participant.identity)
    }
    room.on(RoomEvent.ParticipantDisconnected, onLeave)
    return () => {
      room.off(RoomEvent.ParticipantDisconnected, onLeave)
    }
  }, [room])

  // Safety net for a "typing…" whose stop signal never arrived (crashed
  // worker, dropped packet): a live agent re-heartbeats within the window, so
  // anything older than the stale threshold is genuinely gone.
  useEffect(() => {
    const timer = setInterval(
      () => pruneTypingAgents(TYPING_STALE_MS),
      TYPING_STALE_MS / 2,
    )
    return () => clearInterval(timer)
  }, [])

  // Data messages only reach people already in the room, so the document has
  // to be fetched once on arrival — otherwise everyone who joins after the
  // first line was written sees a blank page until somebody types.
  //
  // Retried with backoff: a knocked-in guest reaches this point holding
  // their "waiting" token while RoomClient is still swapping it for an
  // admitted one, so the first attempt 401s. The retries pick up the fresh
  // token from sessionStorage once the swap lands (and also paper over a
  // briefly-unavailable bridge).
  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const fetchDocSnapshot = (attempt = 0) => {
      const retry = () => {
        if (cancelled || attempt >= 5) return
        retryTimer = setTimeout(
          () => fetchDocSnapshot(attempt + 1),
          500 * 2 ** attempt,
        )
      }
      fetch(`/api/rooms/${slug}/doc`, { headers: roomAuthHeaders(slug) })
        .then((res) => {
          if (!res.ok) {
            retry()
            return null
          }
          return res.json()
        })
        .then((body: { snapshot?: unknown } | null) => {
          if (cancelled || !body) return
          if (typeof body.snapshot === "string" && body.snapshot) {
            // A CRDT state merges with whatever broadcasts raced past it —
            // apply order between this fetch and live updates doesn't matter.
            applyRemoteDocUpdate(body.snapshot)
          }
        })
        .catch(retry)
    }
    const fetchFresh = () => fetchDocSnapshot(0)
    fetchFresh()
    // Refetched after a reconnect: an update lost across the gap would
    // leave Yjs queueing everything after it — the doc looks frozen until
    // a full state fills the hole.
    room.on(RoomEvent.Reconnected, fetchFresh)
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      room.off(RoomEvent.Reconnected, fetchFresh)
    }
  }, [slug, room])

  // Same for the whiteboard (including the admitted-token retry). Records
  // carry their own clocks, so this fetch and any diffs racing past it
  // converge whichever lands first.
  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const fetchCanvasSnapshot = (attempt = 0) => {
      const retry = () => {
        if (cancelled || attempt >= 5) return
        retryTimer = setTimeout(
          () => fetchCanvasSnapshot(attempt + 1),
          500 * 2 ** attempt,
        )
      }
      fetch(`/api/rooms/${slug}/canvas`, { headers: roomAuthHeaders(slug) })
        .then((res) => {
          if (!res.ok) {
            retry()
            return null
          }
          return res.json()
        })
        .then((body) => {
          if (cancelled || !body) return
          const parsed = canvasSnapshotSchema.safeParse(body)
          if (!parsed.success) return
          applyCanvasChanges(parsed.data.records)
        })
        .catch(retry)
    }
    fetchCanvasSnapshot()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [slug])

  useEffect(
    () => () => {
      resetRoomData()
      resetDoc()
      resetDocPresence()
      resetCanvas()
    },
    [],
  )

  return null
}
