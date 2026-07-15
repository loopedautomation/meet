"use client"

import type { AgentInfo } from "@meet/shared"
import { useQuery } from "@tanstack/react-query"

export function useAgents() {
  return useQuery<AgentInfo[]>({
    queryKey: ["agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents")
      if (!res.ok) throw new Error("failed to load agents")
      const data = (await res.json()) as { agents: AgentInfo[] }
      return data.agents
    },
    staleTime: 60_000,
  })
}
