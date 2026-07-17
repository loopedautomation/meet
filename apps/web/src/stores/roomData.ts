import type {
  AgentActivityEvent,
  AgentStatsEvent,
  ChatMessage,
} from "@meet/shared"
import { atom } from "nanostores"

/** Chat + agent activity live here so nothing is missed while panels are closed. */
export const $chatMessages = atom<ChatMessage[]>([])
export const $agentActivity = atom<AgentActivityEvent[]>([])
/** Latest pipeline stats per agent ("stats for nerds"). */
export const $agentStats = atom<Record<string, AgentStatsEvent>>({})

export function addChatMessage(message: ChatMessage) {
  const current = $chatMessages.get()
  if (current.some((m) => m.id === message.id)) return
  $chatMessages.set([...current.slice(-199), message])
}

export function addAgentActivity(event: AgentActivityEvent) {
  if (event.type === "stats") {
    $agentStats.set({ ...$agentStats.get(), [event.agentId]: event })
    return
  }
  $agentActivity.set([...$agentActivity.get().slice(-199), event])
}

export function resetRoomData() {
  $chatMessages.set([])
  $agentActivity.set([])
  $agentStats.set({})
}
