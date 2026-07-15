"use client"

import { useMutation } from "@tanstack/react-query"

export function useAgentInvite(slug: string) {
  return useMutation({
    mutationFn: async ({
      agentId,
      action,
    }: {
      agentId: string
      action: "invite" | "remove"
    }) => {
      const res = await fetch(`/api/rooms/${slug}/agents/${agentId}`, {
        method: action === "invite" ? "POST" : "DELETE",
      })
      if (!res.ok) throw new Error(`agent ${action} failed`)
    },
  })
}
