"use client"

import { useMutation } from "@tanstack/react-query"

export type AgentMode = "realtime" | "pipeline"

export function useAgentInvite(slug: string) {
  return useMutation({
    mutationFn: async ({
      agentId,
      action,
      mode,
    }: {
      agentId: string
      action: "invite" | "remove"
      /** Optional interaction-mode override; omit for the agent's default. */
      mode?: AgentMode
    }) => {
      const res = await fetch(`/api/rooms/${slug}/agents/${agentId}`, {
        method: action === "invite" ? "POST" : "DELETE",
        ...(action === "invite" && mode
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ mode }),
            }
          : {}),
      })
      if (!res.ok) throw new Error(`agent ${action} failed`)
    },
  })
}
