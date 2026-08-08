const path = require("node:path")
const fs = require("node:fs")
const { app, dialog, session } = require("electron")
const { ClaudeRunner } = require("./claude-runner")
const { GatewayClient } = require("./gateway-client")

const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json")
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8")) } catch { return {} }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch }
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true })
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(next, null, 2))
  return next
}

function serverUrl() {
  const saved = loadSettings().serverUrl
  const env = process.env.MEET_SERVER_URL ? new URL(process.env.MEET_SERVER_URL).origin : null
  return saved !== undefined ? saved : env
}

// Per-room state machine
class AgentManager {
  constructor() {
    this.byRoom = new Map() // roomSlug -> { state, runner, gateway, repoPath, error, resumeToken, gatewayUrl }
    this.statusListeners = new Set()
  }

  _emit() {
    const snapshot = {}
    for (const [room, v] of this.byRoom) snapshot[room] = { state: v.state, error: v.error, repoName: v.repoName }
    for (const cb of this.statusListeners) try { cb(snapshot) } catch {}
    // Also send to renderer via window event
    try {
      const { BrowserWindow } = require("electron")
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send("agent:status", snapshot))
    } catch {}
  }

  _set(room, patch) {
    const cur = this.byRoom.get(room) ?? { state: "idle" }
    this.byRoom.set(room, { ...cur, ...patch })
    this._emit()
  }

  async recentRepos() {
    const recents = loadSettings().recentRepos ?? []
    return recents
  }

  async pickRepo() {
    const { dialog } = require("electron")
    const res = await dialog.showOpenDialog({ properties: ["openDirectory"] })
    if (res.canceled || !res.filePaths[0]) return null
    const repoPath = res.filePaths[0]
    // Validate .git
    try { fs.accessSync(path.join(repoPath, ".git")) } catch {
      await dialog.showMessageBox({ type: "error", message: "Not a git repository", detail: `${repoPath} has no .git directory` })
      return null
    }
    let branch = "unknown"
    try {
      const { execSync } = require("node:child_process")
      branch = execSync("git branch --show-current", { cwd: repoPath, encoding: "utf8", timeout: 3000 }).trim() || "unknown"
    } catch {}
    const name = path.basename(repoPath)
    const id = Buffer.from(repoPath).toString("base64url").slice(0, 16)
    const recents = loadSettings().recentRepos ?? []
    const next = [{ id, path: repoPath, name, branch }, ...recents.filter(r => r.path !== repoPath)].slice(0, 10)
    saveSettings({ recentRepos: next })
    return { id, path: repoPath, name, branch }
  }

  async start({ roomSlug, repoId }) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(roomSlug)) return { ok: false, error: "invalid room" }
    const recents = loadSettings().recentRepos ?? []
    const repo = recents.find(r => r.id === repoId)
    if (!repo) return { ok: false, error: "unknown repo" }

    const consent = await dialog.showMessageBox({
      type: "question",
      buttons: ["Allow", "Cancel"],
      defaultId: 0,
      message: `Allow Claude Code to read and edit files in ${repo.path} and run approved commands for room ${roomSlug}?`,
      detail: "The agent will only access files inside that directory and will ask before running shell commands outside the allowlist.",
    })
    if (consent.response !== 0) return { ok: false, error: "consent denied" }

    const base = serverUrl()
    if (!base) return { ok: false, error: "no server configured" }

    this._set(roomSlug, { state: "connecting", repoPath: repo.path, repoName: repo.name })

    // Mint ticket
    let mint
    try {
      const res = await session.defaultSession.fetch(`${base}/api/rooms/${roomSlug}/local-agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `mint failed (${res.status})`)
      }
      mint = await res.json()
    } catch (e) {
      this._set(roomSlug, { state: "error", error: e.message })
      return { ok: false, error: e.message }
    }

    // Spawn runner
    const runner = new ClaudeRunner({
      repoPath: repo.path,
      onEvent: (frame) => {
        // Forward TTY frames to gateway; also surface working state
        const gw = this.byRoom.get(roomSlug)?.gateway
        if (gw) gw.sendFrame(frame)
        if (frame.type === "tool_call") this._set(roomSlug, { state: "working" })
        if (frame.type === "result") this._set(roomSlug, { state: "online" })
        if (frame.type === "error") this._set(roomSlug, { state: "error", error: frame.error })
        if (frame.type === "message" && String(frame.text).includes("Waiting for local approval")) {
          this._set(roomSlug, { state: "awaiting-approval" })
        }
      },
      onPermissionRequest: async (toolName, input) => {
        this._set(roomSlug, { state: "awaiting-approval" })
        const { response } = await dialog.showMessageBox({
          type: "question",
          buttons: ["Allow once", "Always this session", "Deny"],
          defaultId: 0,
          message: `Agent wants to run ${toolName}`,
          detail: JSON.stringify(input).slice(0, 800),
        })
        if (response === 2) {
          this._set(roomSlug, { state: "working" })
          return { behavior: "deny", message: "denied by user" }
        }
        this._set(roomSlug, { state: "working" })
        return { behavior: "allow", updatedInput: input }
      },
    })
    await runner.start({ appendSystemPrompt: `Repo: ${repo.path} (${repo.branch}). You are in LoopMeet room ${roomSlug}.` })
    // Gateway client (native WebSocket)
    const gateway = new GatewayClient({
      gatewayUrl: mint.gatewayUrl,
      ticket: mint.ticket,
      resumeToken: mint.resumeToken,
      onFrame: (frame) => {
        // Inbound from bridge (worker) -> SDK turn
        if (frame.type === "input") {
          this._set(roomSlug, { state: "working" })
          void runner.runTurn(frame.text, frame.images)
        }
        if (frame.type === "hello") {
          // hello from desktop is already sent; this is from worker? ignore
        }
      },
      onStatus: (s) => this._set(roomSlug, { state: s }),
      // Sent from the socket's own open event — a timer here raced the
      // handshake and could silently drop the hello, so the agent never
      // joined and no error surfaced. Re-sent on resume reconnects too;
      // the gateway caches the first hello and relays ignore repeats.
      onOpen: () => {
        gateway.sendFrame({
          type: "hello",
          handle: "claude",
          conversation_id: `${roomSlug}-${mint.agentId}`,
          name: `${repo.name} Claude Code`,
          description: `${repo.name}@${repo.branch}`,
        })
        this._set(roomSlug, { state: "online" })
      },
    })
    gateway.connect()

    this._set(roomSlug, { state: "connecting", runner, gateway, repoPath: repo.path, repoName: repo.name, resumeToken: mint.resumeToken, gatewayUrl: mint.gatewayUrl })

    return { ok: true }
  }

  async stop({ roomSlug }) {
    const cur = this.byRoom.get(roomSlug)
    if (!cur) return
    try { cur.gateway?.close() } catch {}
    try { cur.runner?.kill() } catch {}
    this.byRoom.delete(roomSlug)
    this._emit()
  }

  async status() {
    const snap = {}
    for (const [room, v] of this.byRoom) snap[room] = { state: v.state, error: v.error, repoName: v.repoName }
    return snap
  }

  onStatus(cb) {
    this.statusListeners.add(cb)
    // push initial
    this.status().then(cb)
    return () => this.statusListeners.delete(cb)
  }

  cleanup() {
    for (const [, v] of this.byRoom) {
      try { v.gateway?.close() } catch {}
      try { v.runner?.kill() } catch {}
    }
    this.byRoom.clear()
  }
}

module.exports = { AgentManager }
