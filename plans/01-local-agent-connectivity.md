# Workstream 01 — Local agent runtime & connectivity

How the desktop app spawns the developer's local coding agent and connects it to a
review room as a full agent participant, reusing the existing agent-bridge stack.

Companion: [02-review-surface-and-loop.md](02-review-surface-and-loop.md) rides this
transport; it needs nothing beyond ordinary brain turns.

## Constraints this design is built on (verified against code)

- **Next.js cannot host the WebSocket.** `apps/web` runs `next start` with plain
  route handlers — no upgrade hook. The reverse-connection endpoint lives in the bridge.
- **Bridge `:8090` is deliberately loopback-only** (`docker-compose.yaml`:
  `127.0.0.1:8090:8090`) and gated by the single all-powerful `BRIDGE_TOKEN`. We do
  not expose it; we add a separate ticket-authenticated public port.
- **Control API and LiveKit job workers are separate processes** in the same
  container (specs shared via the file store, see `dynamic.ts`). A socket held by
  the control process is not reachable in-memory from a worker — the worker dials a
  loopback relay instead.
- **`LoopedTtyClient` (`apps/agent-bridge/src/looped-tty.ts`) is the brain
  abstraction** and stays byte-for-byte unchanged: dial-out WS, `bearer.<token>`
  subprotocol, frames `hello / step / assistant / tool_call / tool_result /
  compaction / result / message / error`, input frame `{type:"input", text, images?}`,
  one turn at a time, retry-once, abort = socket drop.
- **`entryFromMetadata` in `worker.ts` already branches** on `agentId.startsWith("dyn-")`
  → file-store spec. A `local-` branch slots in identically. The SSRF guard
  (`publicOnlyLookup`) applies only to `dyn-` agents, so a loopback relay URL is clean.
- **Electron 38 = Node ≥ 22**: native `WebSocket` client and dynamic `import()` of
  ESM from the CJS main process both work — no bundler needed.
- The desktop main window has **no preload today**; Electron detection in the web
  app is a server-side UA sniff in `(app)/layout.tsx`. The desktop cookie jar
  already carries `meet_desktop_session`, so main-process fetches to the server are
  authenticated for free.

## Architecture

```
Electron main (laptop)                      server (docker compose)
┌─────────────────────────┐                ┌──────────────────────────────────────┐
│ claude-runner            │                │ agent-bridge container               │
│  (Claude Agent SDK,      │   wss://:8093  │  ┌─ control API :8090 (loopback)    │
│   child claude process,  │──────────────▶ │  │   + /relay/:id  ← worker dials   │
│   cwd = picked repo)     │  TTY frames    │  ├─ agent-gateway :8093 (public)    │
│ frames.js (SDK↔TTY map)  │  verbatim      │  │   ticket auth, socket registry,  │
│ gateway-client (native   │                │  │   hello cache, pipes frames      │
│  WebSocket, reconnect)   │                │  └─ LiveKit job worker              │
└─────────▲───────────────┘                │      LoopedTtyClient →              │
          │ IPC (preload)                   │      ws://127.0.0.1:8090/relay/:id  │
┌─────────┴───────────────┐    HTTPS        │      (unchanged brain abstraction)  │
│ web UI in shell window   │───────────────▶│ web :3000                            │
│ "Connect my agent" btn   │  mint ticket   │  POST /api/rooms/:slug/local-agent  │
└─────────────────────────┘  (desktop      │   auth: desktop session cookie       │
                              cookie)       │   → bridgeFetch → gateway ticket    │
                                            └──────────────────────────────────────┘
```

The desktop speaks the existing TTY-frame protocol verbatim, just over an outbound
socket. The gateway is a near-dumb pipe between the desktop socket and the worker's
relay socket.

## 1. Reverse connection: the agent gateway

**New file `apps/agent-bridge/src/agent-gateway.ts`**, wired in `index.ts`. Two WS
surfaces, both in the control-API process:

### a) Public gateway — new HTTP server on `AGENT_GATEWAY_PORT` (default 8093)

- Plain `node:http` server + `ws` `WebSocketServer({ noServer: true })` on the
  `upgrade` event (`ws` is already a bridge dependency). Kept off `:8090` so the
  `BRIDGE_TOKEN` API stays loopback-only.
- Path `GET /gateway/agent?ticket=<t>`: single-use ticket, 10-minute TTL, minted by
  the control API (below). Invalid/expired → close `4401`.
- On connect, the desktop's first frame must be `hello` (same shape looped-af
  brains send: `{type:"hello", handle, name, description, conversation_id}`). The
  gateway **caches the hello frame** and replays it to every worker-side relay
  socket that attaches later — preserving `LoopedTtyClient.describe()` and probe
  semantics with no re-announcement from the desktop.
- Connection registry (process memory):
  `Map<connectionId, {room, userId, desktopWs, workerWs|null, hello, resumeToken, lastSeen}>`.
- On hello received: write the local-agent spec to the shared file store and
  `dispatch.createDispatch(room, "looped-bridge", {metadata: JSON.stringify({agentId, mode: "text"})})`
  — the agent appears in the room only once its brain is actually online.
- Heartbeat: WS ping every 20 s; drop after 2 missed.

### b) Loopback relay — attached to the existing `:8090` server

- `serve()` from `@hono/node-server` returns the `http.Server`; attach an `upgrade`
  handler for path `/relay/:connectionId`, authenticated with the
  `bearer.<relayToken>` subprotocol — exactly what `LoopedTtyClient` already sends.
  The per-connection `relayToken` is a fresh 32-byte secret stored in the spec file
  so the worker process can read it.
- Relay semantics: pipe frames both ways; replay cached `hello` on each worker
  attach; one worker socket at a time (a new attach closes the old — matching the
  TTY trigger's per-socket run flag that `abortTurn()` relies on).

### Ticket mint — new control-API route (`index.ts`): `POST /rooms/:room/local-agents`

- `BRIDGE_TOKEN`-gated like everything else; called only by `apps/web` server-side
  via `bridgeFetch`.
- Body `{ userId, userName }` → `{ agentId: "local-<8hex>", ticket, gatewayPath: "/gateway/agent" }`.
- Reuses the invite rate limiter (`inviteAllowed`). Enforce **one local agent per
  (room, user)**: a second mint revokes the first connection.

### Reconnection

- **Desktop socket drops mid-session:** gateway closes the worker-side relay socket
  (so `LoopedTtyClient`'s existing close/retry/timeout logic does the right thing),
  keeps the connection record for a **120 s grace window**, and honors a redial
  carrying the `resumeToken` issued at first attach. Past the window:
  `rooms.removeParticipant(room, "agent-<id>")` and delete the record.
- **Worker redispatch/crash:** the relay accepts the next attach; the desktop
  notices nothing.

### Multiplexing

V1 is one gateway connection per (room, user). A laptop in two review rooms holds
two sockets — trivially correct, no channel framing. A multiplexed daemon
connection is deferred.

### Compose / URL advertisement

- `docker-compose.yaml`: add `"8093:8093"` to `agent-bridge` ports (public — it
  carries only ticketed sockets).
- `apps/web` env `AGENT_GATEWAY_PUBLIC_URL` (e.g. `wss://meet.example.com:8093`, or
  a reverse-proxied path); local-dev fallback derived from the request host with
  port 8093 and `ws://`. Returned to the desktop in the mint response — the desktop
  never guesses.
- `selfhost.md`: production needs TLS in front of 8093 (same reverse proxy as
  `:3000`); include the proxy stanza.

## 2. Auth & data flow (end to end)

1. Renderer calls `meetShell.agent.start({ roomSlug })` (preload IPC).
2. Electron main validates `roomSlug` (`/^[a-z0-9][a-z0-9-]{0,63}$/`), runs the repo
   picker + a native consent dialog ("Allow Claude Code to read and edit files in
   `<repo>` and run approved commands for room `<slug>`?").
3. Main POSTs `${serverUrl()}/api/rooms/${slug}/local-agent` via
   `session.defaultSession.fetch(..., {credentials: "include"})` — authenticated by
   the existing `meet_desktop_session` cookie (same pattern as `fetchChannels()`).
4. **New route `apps/web/src/app/api/rooms/[slug]/local-agent/route.ts`**:
   `getSessionUser()` + room membership check (guard pattern from the existing
   `api/rooms/[slug]` handlers), then `bridgeFetch("/rooms/<room>/local-agents", …)`;
   responds `{ gatewayUrl, ticket, agentId }` where
   `gatewayUrl = AGENT_GATEWAY_PUBLIC_URL + gatewayPath`.
5. Main spawns the agent runtime (§3), dials the gateway with the native
   `WebSocket`, sends `hello` (`name: "<userName>'s Claude Code"`,
   `description: "<repoName>@<branch>"`).
6. Gateway registers the spec + dispatches; `agent-local-<id>` joins the room;
   status events stream back to the renderer.

No new secret classes: the desktop session authorizes the mint; the ticket
authorizes exactly one socket; the relay token never leaves the container.

## 3. Spawning Claude Code

**Recommendation: `@anthropic-ai/claude-agent-sdk`, pointed at the user's installed
`claude` binary.**

- Rejected: `node-pty` interactive (screen-scraping a TUI; fragile, unstructured).
- Considered: raw `claude --print --input-format stream-json --output-format stream-json`
  — workable, but hand-rolls the control protocol (permission requests, interrupts,
  session resume) the SDK already implements over the same transport.
- SDK is loaded via dynamic `import()` in the CJS main process (no bundler change).
  `pathToClaudeCodeExecutable` resolves to the user's own `claude` install so their
  credentials/subscription and CLI version are used; fall back to the SDK's bundled
  CLI. Resolve robustly on macOS GUI launch (no shell PATH): probe
  `~/.claude/local/claude`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`,
  then a login-shell `which claude`.

Per-session options: `cwd: repoPath`, `permissionMode: "acceptEdits"` (**never**
`bypassPermissions` by default), `systemPrompt: {preset: "claude_code", append: <review-room context>}`,
`resume: <sessionId>` on crash restart, `canUseTool` for prompts. `gh`/`git`
credentials come free from the inherited user environment — which is exactly the
PR-data story workstream 02 relies on.

**Permission UX:** `canUseTool` → session allowlist check (Read/Grep/Glob and edits
inside `cwd` auto-allowed by acceptEdits; Bash and out-of-tree access prompt) →
native Electron dialog with *Allow once / Always this session / Deny*. While a
prompt is pending, the runner emits a TTY `message` frame ("Waiting for local
approval to run `pnpm test`…") so the room sees why the agent stalled — no protocol
extension needed.

**SDK → TTY frame mapping** (new `apps/desktop/src/agent/frames.js`):

| SDK event | TTY frame |
|---|---|
| session init | `hello` (sent once at gateway connect) |
| assistant message, text block | `{type:"assistant", content}` |
| assistant message, tool_use block | `{type:"tool_call", name, arguments: JSON.stringify(input)}` |
| user message, tool_result block | `{type:"tool_result", name, content (truncated ~4KB), durationMs}` |
| each assistant turn | `{type:"step", n}` |
| result message | `{type:"result", status: "ok"\|"error", reply, steps: num_turns}` |
| SDK/process error | `{type:"error", error}` |

Inbound `{type:"input", text, images?}` → one SDK turn (streaming-input async
iterable, one turn at a time — matching `LoopedTtyClient`'s queueing). Desktop-side
socket close mid-turn → `interrupt()` the SDK but keep the session alive for resume
(mirrors `abortTurn()` semantics).

The mapper is the **adapter seam for other agents**: one adapter interface,
per-agent implementations (Codex/OpenCode deferred).

## 4. Electron surface

**Modified `apps/desktop/src/main.js`:**
- Attach a new preload to `createMainWindow` (`webPreferences.preload: workspace-preload.js`).
- Add a `will-navigate` guard restricting the main window to the configured server
  origin (closes the "preload exposed to a foreign page" hole).
- Register IPC handlers; kill child agents + close sockets in `will-quit`.

**New `apps/desktop/src/workspace-preload.js`** (contextBridge):

```js
window.meetShell = {
  info: { version, platform, capabilities: ["local-agent"] },
  agent: {
    pickRepo(): Promise<{id, path, name, branch} | null>,  // native dialog; main validates .git
    recentRepos(): Promise<Repo[]>,                         // from settings.json
    start({roomSlug, repoId}): Promise<{ok} | {ok:false, error}>,
    stop({roomSlug}): Promise<void>,
    status(): Promise<Record<roomSlug, AgentStatus>>,
    onStatus(cb): unsubscribe,
    // AgentStatus.state: idle|picking|connecting|online|working|awaiting-approval|reconnecting|error|stopped
  },
}
```

Security: the renderer never passes filesystem paths or command strings — only an
opaque `repoId` (an entry in the main-process recents list) and a validated room
slug. All spawning, path validation, and dialogs happen in main.

**New files:**
- `apps/desktop/src/agent/manager.js` — per-room state machine; supervises runner +
  gateway client; crash restart with backoff ×3 then error state.
- `apps/desktop/src/agent/claude-runner.js` — SDK session lifecycle.
- `apps/desktop/src/agent/gateway-client.js` — native WebSocket, resume-token reconnect.
- `apps/desktop/src/agent/frames.js` — SDK ↔ TTY mapping.

**Web side:**
- `window.meetShell` presence is the client-side shell detection (keep the UA sniff
  for the server-rendered drag strip). New `apps/web/src/types/meet-shell.d.ts`.
- New "Connect my coding agent" section in
  `apps/web/src/components/room/panels/AgentsPanel.tsx`: repo picker trigger, live
  status line, stop button. Non-desktop browsers see a hint ("Open this room in the
  looped meet desktop app to bring your local agent") — graceful degradation.

## 5. Lifecycle & UX

- **Join:** "Connect my agent" → repo pick (recents-first) → consent dialog → spawn
  → gateway hello → agent participant appears (existing join affordances,
  `AgentBadge`, activity feed all work — it's an ordinary bridge agent).
- **Crash:** child exit → manager restarts with `resume: sessionId` (≤3 attempts)
  while the gateway connection stays up; the room sees a `message` frame.
  Unrecoverable → `error` frame + status event.
- **Meeting end:** existing empty-room teardown removes the worker; on participant
  removal the gateway sends `{type:"end", reason}` to the desktop then closes; the
  desktop kills the child and clears status.
- **Multiple humans:** each mint produces a distinct `local-<id>`; identities
  `agent-local-<id>` never collide; names are per-user ("Ratul's Claude Code").
- **Multiple rooms, one laptop:** independent connections/child processes; the
  manager keys everything by roomSlug.

## 6. Voice/text scope — text-first for v1

Add `mode: "text"` to the worker (`DispatchMeta` union + a branch that skips
`voice.AgentSession`/realtime entirely: join, set state attributes, wire the chat
handler + shared-doc/canvas/review context + activity-feed publishing from
`tool_call`/`tool_result` frames, no audio tracks).

Rationale: revision turns run minutes; voice presence buys latency pain and
realtime cost for a workflow that is text/artifact-shaped. Because the brain
abstraction is unchanged, voice later is literally `mode: "pipeline"` on the same
connection.

One knob now: pass `turnTimeoutMs: 30 * 60_000` through the local-agent spec into
`brainOpts` (`LoopedTtyClient` defaults to 10 min — a real revision can exceed it).

## 7. Protocol / handshake changes

- **No `PROTOCOL_VERSION` bump** — everything is additive per `protocol.ts`'s own
  rules. Add optional `capabilities?: string[]` to `HandshakeResponse` in
  `packages/shared/src/protocol.ts`; `/api/health` advertises `["local-agents"]`
  when `AGENT_GATEWAY_PUBLIC_URL` is configured. The desktop gates the whole
  feature on this capability, so old servers degrade to the hint text.
- **Issue #214** (handshake constants duplicated in `main.js`): keep the documented
  duplication but enforce it — new `scripts/check-protocol-sync.mjs` (CI +
  `pnpm test`) regex-extracts `CLIENT_PROTOCOL` / `MIN_SERVER_PROTOCOL` /
  `SERVICE_ID` from `main.js` and asserts they match `protocol.ts` exports.
  (Alternative — esbuild-bundle the desktop and import `@meet/shared` — is cleaner
  long-term but an orthogonal packaging change; deferred.)

## 8. Touched files

New:
- `apps/agent-bridge/src/agent-gateway.ts`
- `apps/desktop/src/workspace-preload.js`
- `apps/desktop/src/agent/{manager,claude-runner,gateway-client,frames}.js`
- `apps/web/src/app/api/rooms/[slug]/local-agent/route.ts`
- `apps/web/src/types/meet-shell.d.ts`
- `scripts/check-protocol-sync.mjs`

Modified:
- `apps/agent-bridge/src/index.ts` (gateway server wiring, relay upgrade, mint route)
- `apps/agent-bridge/src/worker.ts` (`local-` entry branch, `mode: "text"`, turn-timeout passthrough)
- `apps/desktop/src/main.js` (preload attachment, IPC, navigation guard, cleanup)
- `apps/web/src/components/room/panels/AgentsPanel.tsx` ("Connect my coding agent")
- `packages/shared/src/protocol.ts` (+ its test) — `capabilities`
- `apps/web/src/app/api/health/route.ts` — advertise capability
- `docker-compose.yaml`, `selfhost.md`, `apps/desktop/electron-builder.yml` (SDK packaging check)

Read, not modified: `apps/agent-bridge/src/looped-tty.ts` (the contract everything preserves).

## 9. Risks & open questions

- **TLS on `:8093` for self-hosters** — wss needs a cert; docs must show the
  reverse-proxy stanza; dev must allow `ws://`. Fallback if painful: proxy the
  gateway path through whatever already fronts `:3000`.
- **Turn duration vs `turnTimeoutMs`** — 30 min covers most revisions; very long
  ones may want progress-keepalive semantics later.
- **SDK packaging in electron-builder** — verify `asarUnpack` needs for the SDK's
  bundled CLI fallback; using the user's binary sidesteps most of it.
- **Structured frames** — workstream 02 needs only ordinary turns + marker blocks.
  If structured frames are ever wanted, they ride as new TTY frame types the relay
  pipes opaquely; no gateway change.
