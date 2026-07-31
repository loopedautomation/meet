"use client"

import { useMutation } from "@tanstack/react-query"
import { track } from "@/lib/analytics"
import { readHostKey } from "@/lib/hostKey"
import { roomAuthHeaders } from "@/lib/roomAuth"
import { $isHost } from "@/stores/host"

export type AgentMode =
  | "realtime"
  | "realtime-mini"
  | "gemini"
  | "pipeline"
  | "elevenlabs"

export function useAgentInvite(slug: string) {
  return useMutation({
    mutationFn: async ({
      agentId,
      action,
      mode,
      voice,
    }: {
      agentId: string
      action: "invite" | "remove"
      /** Optional interaction-mode override; omit for the agent's default. */
      mode?: AgentMode
      /** Optional voice override; must belong to the resolved mode's provider. */
      voice?: string
    }) => {
      // Presented so the host still gets through when they've reserved
      // agent invites for themselves; ignored when they haven't.
      const hostKey = readHostKey(slug)
      const overrides =
        action === "invite" && (mode || voice)
          ? { ...(mode ? { mode } : {}), ...(voice ? { voice } : {}) }
          : null
      const res = await fetch(`/api/rooms/${slug}/agents/${agentId}`, {
        method: action === "invite" ? "POST" : "DELETE",
        headers: {
          ...(hostKey ? { "x-host-key": hostKey } : {}),
          ...(overrides ? { "content-type": "application/json" } : {}),
          // Proves room membership — invites are refused without it.
          ...roomAuthHeaders(slug),
        },
        ...(overrides ? { body: JSON.stringify(overrides) } : {}),
      })
      // The status travels in the message so the error handler can report a
      // code without the caller having to care.
      if (!res.ok) throw new Error(`http_${res.status}`)
    },
    onSuccess: (_data, { agentId, action, mode }) => {
      if (action === "invite") {
        track("agent_added", {
          agent_type: agentId,
          added_by_role: $isHost.get() ? "host" : "guest",
          // The panel resolves the registry default before inviting, so this
          // is normally the real mode; "default" only shows up for invite
          // paths that don't pick one (URL-invited agents).
          mode: mode ?? "default",
        })
      } else {
        track("agent_removed", { agent_type: agentId, reason: "user_removed" })
      }
    },
    onError: (error, { agentId, action }) => {
      const code = /^http_\d+$/.test(error.message) ? error.message : "network"
      track("agent_error", {
        agent_type: agentId,
        error_code: `${action}_${code}`,
      })
      // A failed removal leaves the agent in the call — recorded as an error
      // rather than a removal so the two don't cancel out in the funnel.
      if (action === "remove") {
        track("agent_removed", { agent_type: agentId, reason: "error" })
      }
    },
  })
}
