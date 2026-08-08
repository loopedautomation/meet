import { randomBytes } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk"
import { WebSocket, WebSocketServer } from "ws"
import { getLocalAgent, newLocalAgentId, newSecret, registerLocalAgent } from "./local-agent-store.js"

// Gateway: desktop <--wss://:8093--> bridge <--ws://127.0.0.1:8090/relay/:id--> worker (LoopedTtyClient)
// The TTY frame protocol is passed verbatim; the gateway is a dumb pipe with hello caching.

type GatewayConn = {
  connectionId: string // == agentId (local-<hex>)
  room: string
  userId: string
  userName: string
  ticket: string
  resumeToken: string
  relayToken: string
  hello: unknown | null
  desktopWs: WebSocket | null
  workerWs: WebSocket | null
  createdAt: number
  lastSeen: number
  dispatchDone: boolean
}

const TICKET_TTL_MS = 10 * 60 * 1000
const GRACE_MS = 120 * 1000
const PING_MS = 20_000

// Single-use tickets: ticket -> {room, userId, userName, agentId, expiresAt, resumeToken, relayToken}
const tickets = new Map<string, { room: string; userId: string; userName: string; agentId: string; expiresAt: number; resumeToken: string; relayToken: string }>()

// One local agent per (room,user) — map key `${room}:${userId}` -> connectionId
const byRoomUser = new Map<string, string>()

// All live gateway connections by connectionId
const conns = new Map<string, GatewayConn>()

// Reverse from worker relayToken to connectionId for auth on /relay/:id
const relayTokenToId = new Map<string, string>()

// One-per-(room,user) invite rate limit reuses inviteAllowed from index — we expose a similar window here.
// For gateway, we rely on caller's own limit; mint just replaces old connection.

let dispatchClient: AgentDispatchClient | null = null
let roomClient: RoomServiceClient | null = null

export function initAgentGateway(clients: { dispatch: AgentDispatchClient; rooms: RoomServiceClient }): void {
  dispatchClient = clients.dispatch
  roomClient = clients.rooms
}

function mintTicket(room: string, userId: string, userName: string): { agentId: string; ticket: string; gatewayPath: string; resumeToken: string; relayToken: string } {
  const key = `${room}:${userId}`
  const oldId = byRoomUser.get(key)
  if (oldId) {
    const old = conns.get(oldId)
    if (old) {
      try { old.desktopWs?.close(4000, "replaced") } catch {}
      try { old.workerWs?.close(4000, "replaced") } catch {}
      conns.delete(oldId)
      relayTokenToId.delete(old.relayToken)
    }
    // also clear tickets for that old agent if any dangling
    for (const [t, v] of tickets) if (v.agentId === oldId) tickets.delete(t)
  }

  const agentId = newLocalAgentId()
  const ticket = randomBytes(32).toString("hex")
  const resumeToken = newSecret(32)
  const relayToken = newSecret(32)
  const expiresAt = Date.now() + TICKET_TTL_MS
  tickets.set(ticket, { room, userId, userName, agentId, expiresAt, resumeToken, relayToken })

  // Persist spec so worker can dial loopback relay
  const port = Number(process.env.PORT ?? 8090)
  const url = `ws://127.0.0.1:${port}/relay/${agentId}`
  registerLocalAgent({
    agentId,
    room,
    userId,
    userName,
    relayToken,
    resumeToken,
    createdAt: Date.now(),
    url,
  })

  byRoomUser.set(key, agentId)

  // Auto-expire ticket
  setTimeout(() => tickets.delete(ticket), TICKET_TTL_MS).unref?.()

  return { agentId, ticket, gatewayPath: "/gateway/agent", resumeToken, relayToken }
}

// Called by control API route POST /rooms/:room/local-agents
export function handleMintRequest(room: string, body: { userId?: string; userName?: string }): { status: number; body: unknown } {
  if (!body.userId || !body.userName) return { status: 400, body: { error: "userId and userName required" } }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(room)) return { status: 400, body: { error: "invalid room" } }
  // Enforce simple per-room rate limit via global is checked in index before calling, but double-check not needed.
  const { agentId, ticket, gatewayPath, resumeToken, relayToken } = mintTicket(room, body.userId, body.userName)
  // Return what desktop needs: it will dial wss://host:8093/gateway/agent?ticket=... and then send hello
  return { status: 200, body: { agentId, ticket, gatewayPath, resumeToken, relayToken } }
}

// Public gateway server on AGENT_GATEWAY_PORT (8093)
let publicServer: ReturnType<typeof createServer> | null = null
let publicWss: WebSocketServer | null = null

export function startAgentGateway(): void {
  const port = Number(process.env.AGENT_GATEWAY_PORT ?? 8093)
  publicServer = createServer((req, res) => {
    res.writeHead(404); res.end()
  })

  publicWss = new WebSocketServer({ noServer: true })

  publicServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`)
    if (url.pathname !== "/gateway/agent") {
      socket.destroy()
      return
    }
    const ticket = url.searchParams.get("ticket")
    const resume = url.searchParams.get("resume")
    // Resume path: must present valid resumeToken for existing conn
    if (resume) {
      const conn = [...conns.values()].find(c => c.resumeToken === resume)
      if (!conn) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
        socket.destroy()
        return
      }
      // Reattach desktop socket
      publicWss!.handleUpgrade(req, socket, head, (ws) => {
        attachDesktopWs(conn, ws)
      })
      return
    }
    if (!ticket || !tickets.has(ticket)) {
      // No ticket and not a resume -> reject
      // We still need to handle upgrade to send WS close code; simplest: destroy with 401
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      socket.destroy()
      return
    }
    const info = tickets.get(ticket)!
    if (Date.now() > info.expiresAt) {
      tickets.delete(ticket)
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      socket.destroy()
      return
    }
    tickets.delete(ticket)
    // Create conn record
    const conn: GatewayConn = {
      connectionId: info.agentId,
      room: info.room,
      userId: info.userId,
      userName: info.userName,
      ticket,
      resumeToken: info.resumeToken,
      relayToken: info.relayToken,
      hello: null,
      desktopWs: null,
      workerWs: null,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      dispatchDone: false,
    }
    conns.set(conn.connectionId, conn)
    relayTokenToId.set(conn.relayToken, conn.connectionId)

    publicWss!.handleUpgrade(req, socket, head, (ws) => {
      attachDesktopWs(conn, ws)
    })
  })

  publicServer.listen(port, () => {
    console.log(`agent-gateway public on :${port}`)
  })

  // GC stale conns past grace window with no desktopWs
  setInterval(() => {
    const now = Date.now()
    for (const [id, c] of conns) {
      if (!c.desktopWs && now - c.lastSeen > GRACE_MS) {
        conns.delete(id)
        relayTokenToId.delete(c.relayToken)
        byRoomUser.delete(`${c.room}:${c.userId}`)
        if (roomClient) {
          roomClient.removeParticipant(c.room, `agent-${id}`).catch(() => undefined)
        }
      }
    }
    // prune expired tickets
    for (const [t, v] of tickets) if (Date.now() > v.expiresAt) tickets.delete(t)
  }, 30_000).unref?.()
}

function attachDesktopWs(conn: GatewayConn, ws: WebSocket): void {
  // One desktop socket at a time per connection
  if (conn.desktopWs && conn.desktopWs.readyState === WebSocket.OPEN) {
    try { conn.desktopWs.close(4000, "replaced") } catch {}
  }
  conn.desktopWs = ws
  conn.lastSeen = Date.now()

  let helloReceived = conn.hello !== null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let missed = 0

  const heartbeat = () => {
    if (ws.readyState !== WebSocket.OPEN) return
    if (missed >= 2) {
      ws.terminate()
      return
    }
    missed++
    try { ws.ping() } catch {}
  }
  ws.on("pong", () => { missed = 0 })

  pingTimer = setInterval(heartbeat, PING_MS)
  pingTimer.unref?.()

  ws.on("message", (data) => {
    conn.lastSeen = Date.now()
    let frame: unknown
    try { frame = JSON.parse(String(data)) } catch { return }
    const f = frame as Record<string, unknown>
    if (!helloReceived && f.type === "hello") {
      helloReceived = true
      conn.hello = frame
      // Persist hello to file store so relay replay can include it if needed
      const existing = getLocalAgent(conn.connectionId)
      if (existing) {
        registerLocalAgent({ ...existing, hello: frame })
      }
      // Dispatch agent into room only once hello is known (name/description)
      if (!conn.dispatchDone && dispatchClient) {
        conn.dispatchDone = true
        const name = (f.name as string) || `${conn.userName}'s Claude Code`
        // The worker will look up LocalAgentSpec by agentId; dispatch just needs the id
        dispatchClient.createDispatch(conn.room, "looped-bridge", {
          metadata: JSON.stringify({ agentId: conn.connectionId, mode: "text" }),
        }).catch((err) => console.error("local agent dispatch failed", err))
        // Also, we could set participant name via metadata, but worker's acceptRequest uses entry.name derived from spec.
        // Name propagation: the relay's hello cache will deliver name to worker's describe().
      }
      // If worker already attached, replay hello immediately
      if (conn.workerWs && conn.workerWs.readyState === WebSocket.OPEN) {
        try { conn.workerWs.send(JSON.stringify(frame)) } catch {}
      }
      return
    }
    // Forward all non-hello frames to worker if attached
    if (conn.workerWs && conn.workerWs.readyState === WebSocket.OPEN) {
      try { conn.workerWs.send(String(data)) } catch {}
    }
  })

  const cleanup = () => {
    if (pingTimer) clearInterval(pingTimer)
    if (conn.desktopWs === ws) {
      conn.desktopWs = null
      conn.lastSeen = Date.now()
      // Close worker side to signal bridge abort; worker will retry on next dispatch
      if (conn.workerWs && conn.workerWs.readyState === WebSocket.OPEN) {
        try { conn.workerWs.close(4000, "desktop disconnected") } catch {}
        conn.workerWs = null
      }
      // Keep conn for GRACE_MS for resume; if hello never arrived, drop quickly
      if (!conn.hello) {
        conns.delete(conn.connectionId)
        relayTokenToId.delete(conn.relayToken)
        byRoomUser.delete(`${conn.room}:${conn.userId}`)
      }
    }
  }

  ws.on("close", cleanup)
  ws.on("error", cleanup)
}

// Loopback relay for worker's LoopedTtyClient -- attach to existing :8090 server
// Called from index.ts after serve() returns the http.Server
export function attachRelayUpgrade(server: ReturnType<typeof createServer>): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`)
    const m = url.pathname.match(/^\/relay\/([^/]+)$/)
    if (!m) return // not ours, let other handlers decide (though we are only relay)
    const connectionId = m[1]
    const conn = conns.get(connectionId)
    // Fallback: if control process restarted, load from file store
    let expectedToken: string | undefined
    if (conn) expectedToken = conn.relayToken
    else {
      const spec = getLocalAgent(connectionId)
      if (spec) {
        expectedToken = spec.relayToken
        // Recreate minimal conn so relay can function even without prior desktop ws in this process
        // This happens after a control-API restart before gateway state rebuilt
        const restored: GatewayConn = {
          connectionId,
          room: spec.room,
          userId: spec.userId,
          userName: spec.userName,
          ticket: "",
          resumeToken: spec.resumeToken,
          relayToken: spec.relayToken,
          hello: (spec.hello as unknown) ?? null,
          desktopWs: null,
          workerWs: null,
          createdAt: spec.createdAt,
          lastSeen: Date.now(),
          dispatchDone: true,
        }
        conns.set(connectionId, restored)
        relayTokenToId.set(spec.relayToken, connectionId)
      }
    }
    if (!expectedToken) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
      socket.destroy()
      return
    }
    // Auth via Sec-WebSocket-Protocol: bearer.<relayToken>
    const proto = req.headers["sec-websocket-protocol"] ?? ""
    const want = `bearer.${expectedToken}`
    const protos = String(proto).split(",").map(s => s.trim())
    if (!protos.includes(want)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      socket.destroy()
      return
    }

    const wss = new WebSocketServer({ noServer: true })
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleWorkerAttach(connectionId, ws, want)
    })
  })
}

function handleWorkerAttach(connectionId: string, ws: WebSocket, protocol: string): void {
  const conn = conns.get(connectionId)
  if (!conn) {
    ws.close(4401, "unknown connection")
    return
  }
  // One worker socket at a time
  if (conn.workerWs && conn.workerWs.readyState === WebSocket.OPEN) {
    try { conn.workerWs.close(4000, "replaced") } catch {}
  }
  conn.workerWs = ws
  // Replay cached hello so LoopedTtyClient.describe() works
  if (conn.hello) {
    try { ws.send(JSON.stringify(conn.hello)) } catch {}
  }

  ws.on("message", (data) => {
    if (conn.desktopWs && conn.desktopWs.readyState === WebSocket.OPEN) {
      try { conn.desktopWs.send(String(data)) } catch {}
    }
  })

  const cleanup = () => {
    if (conn.workerWs === ws) conn.workerWs = null
  }
  ws.on("close", cleanup)
  ws.on("error", cleanup)
}

export function _testReset(): void {
  tickets.clear()
  conns.clear()
  byRoomUser.clear()
  relayTokenToId.clear()
}
