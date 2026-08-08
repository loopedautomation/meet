export type AgentStatusState =
  | "idle"
  | "picking"
  | "connecting"
  | "online"
  | "working"
  | "awaiting-approval"
  | "reconnecting"
  | "error"
  | "stopped"

export interface MeetShell {
  info: {
    version: string
    platform: string
    capabilities: string[]
  }
  agent: {
    pickRepo(): Promise<{ id: string; path: string; name: string; branch: string } | null>
    recentRepos(): Promise<Array<{ id: string; path: string; name: string; branch: string }>>
    start(opts: { roomSlug: string; repoId: string }): Promise<{ ok: true } | { ok: false; error: string }>
    stop(opts: { roomSlug: string }): Promise<void>
    status(): Promise<Record<string, { state: AgentStatusState; error?: string; repoName?: string }>>
    onStatus(cb: (status: Record<string, { state: AgentStatusState; error?: string }>) => void): () => void
  }
}

declare global {
  interface Window {
    meetShell?: MeetShell
  }
}
