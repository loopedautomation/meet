const os = require("node:os")
const path = require("node:path")
const fs = require("node:fs")
const { spawn } = require("node:child_process")

// Resolve claude binary robustly on macOS GUI launch (no shell PATH)
async function resolveClaudeBinary() {
  const candidates = [
    path.join(os.homedir(), ".claude/local/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(os.homedir(), ".local/bin/claude"),
  ]
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); return c } catch {}
  }
  // fallback: login-shell which
  try {
    const { execSync } = require("node:child_process")
    const out = execSync("which claude", { shell: "/bin/zsh -l", encoding: "utf8", timeout: 3000 }).trim()
    if (out) return out
  } catch {}
  return "claude"
}

class ClaudeRunner {
  constructor({ repoPath, onEvent, onPermissionRequest }) {
    this.repoPath = repoPath
    this.onEvent = onEvent
    this.onPermissionRequest = onPermissionRequest
    this.sdkSession = null
    this.sessionId = null
  }

  async start({ appendSystemPrompt } = {}) {
    // Dynamic import of ESM SDK from CJS main process
    let sdk
    try {
      sdk = await import("@anthropic-ai/claude-agent-sdk")
    } catch (e) {
      this.onEvent?.({ type: "error", error: `Claude Agent SDK not available: ${e.message}. Install @anthropic-ai/claude-agent-sdk or set pathToClaudeCodeExecutable.` })
      return
    }
    const binary = await resolveClaudeBinary()
    const opts = {
      cwd: this.repoPath,
      permissionMode: "acceptEdits",
      pathToClaudeCodeExecutable: binary,
      systemPrompt: { preset: "claude_code", append: appendSystemPrompt ?? "You are in a LoopMeet review room. Respond helpfully, be concise, and handle <<<REVIEW blocks if present." },
      canUseTool: async (toolName, input) => {
        // Auto-allow read/grep/glob inside cwd, edits inside cwd
        const safe = ["Read", "Grep", "Glob", "Bash", "Edit", "Write"].includes(toolName)
        // For anything else, ask the user via native dialog callback
        if (this.onPermissionRequest) {
          const decision = await this.onPermissionRequest(toolName, input)
          return decision // { behavior: "allow" | "deny", updatedInput?: ... }
        }
        return { behavior: "allow", updatedInput: input }
      },
    }
    this.sdk = sdk
    this.opts = opts
    this.onEvent?.({ type: "hello", handle: "claude", name: "Claude Code", description: `${path.basename(this.repoPath)}` })
  }

  async runTurn(text, _images) {
    if (!this.sdk) return
    try {
      // One query per turn, resumed by session id so the conversation (and
      // the CLI process's context) carries across turns. The SDK takes a
      // single {prompt, options} argument. Images from the TTY frame are
      // dropped for now — text-mode agents never receive screenshare frames.
      const query = this.sdk.query({
        prompt: text,
        options: { ...this.opts, resume: this.sessionId ?? undefined },
      })
      this.activeQuery = query
      for await (const ev of query) {
        if (ev.session_id) this.sessionId = ev.session_id
        const frames = mapSdkEvent(ev)
        for (const f of frames) this.onEvent?.(f)
      }
    } catch (err) {
      this.onEvent?.({ type: "error", error: err.message ?? String(err) })
    } finally {
      this.activeQuery = null
    }
  }

  interrupt() {
    // Stops the in-flight turn but keeps sessionId for resume — mirrors the
    // bridge's abortTurn() semantics (socket drop aborts, conversation lives).
    try { this.activeQuery?.interrupt?.() } catch {}
  }

  kill() {
    try { this.activeQuery?.interrupt?.() } catch {}
    try { this.sdkSession?.close?.() } catch {}
  }
}

function mapSdkEvent(ev) {
  // Reuse frames.js logic if available
  try {
    const { sdkToTty } = require("./frames")
    const res = sdkToTty(ev)
    if (res) return Array.isArray(res[0]) ? res.flat() : res
  } catch {}
  // fallback minimal
  if (ev.type === "assistant" && ev.message?.content) {
    const text = ev.message.content.filter(b => b.type === "text").map(b => b.text).join("")
    if (text) return [{ type: "assistant", content: text }]
  }
  if (ev.type === "result") return [{ type: "result", status: ev.is_error ? "error" : "ok", reply: ev.result ?? "", steps: 1 }]
  if (ev.type === "error") return [{ type: "error", error: ev.error ?? String(ev) }]
  return []
}

module.exports = { ClaudeRunner, resolveClaudeBinary }
