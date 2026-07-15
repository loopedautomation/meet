import { serve } from "@hono/node-server"
import { AgentServer, initializeLogger, ServerOptions } from "@livekit/agents"
import { Hono } from "hono"
import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk"
import { loadRegistry } from "./registry.js"
import { acceptRequest } from "./worker.js"

const PORT = Number(process.env.PORT ?? 8090)
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "ws://localhost:7880"
const httpUrl = LIVEKIT_URL.replace(/^ws/, "http")

if (!BRIDGE_TOKEN) {
  console.error("BRIDGE_TOKEN is required")
  process.exit(1)
}

initializeLogger({ pretty: false, level: process.env.LOG_LEVEL ?? "info" })

const dispatch = new AgentDispatchClient(httpUrl)
const rooms = new RoomServiceClient(httpUrl)

const app = new Hono()

app.get("/health", (c) => c.json({ ok: true }))

app.use("*", async (c, next) => {
  if (c.req.path === "/health") return next()
  const auth = c.req.header("authorization")
  if (auth !== `Bearer ${BRIDGE_TOKEN}`) {
    return c.json({ error: "unauthorized" }, 401)
  }
  return next()
})

app.get("/agents", (c) => {
  const agents = loadRegistry().map(({ id, name, description, avatar }) => ({
    id,
    name,
    description,
    avatar,
  }))
  return c.json({ agents })
})

app.post("/rooms/:room/agents/:id", async (c) => {
  const { room, id } = c.req.param()
  const entry = loadRegistry().find((a) => a.id === id)
  if (!entry) return c.json({ error: "unknown agent" }, 404)

  const participants = await rooms.listParticipants(room).catch(() => [])
  if (participants.some((p) => p.identity === `agent-${id}`)) {
    return c.json({ ok: true, already: true })
  }

  await dispatch.createDispatch(room, "looped-bridge", {
    metadata: JSON.stringify({ agentId: id }),
  })
  return c.json({ ok: true })
})

app.delete("/rooms/:room/agents/:id", async (c) => {
  const { room, id } = c.req.param()
  await rooms.removeParticipant(room, `agent-${id}`).catch(() => undefined)
  return c.json({ ok: true })
})

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`agent-bridge control API on :${info.port}`)
})

// The LiveKit Agents worker: hosts the voice pipeline for dispatched agents.
const server = new AgentServer(
  new ServerOptions({
    agent: new URL("./worker.js", import.meta.url).pathname,
    agentName: "looped-bridge",
    requestFunc: acceptRequest,
    wsURL: LIVEKIT_URL,
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    // The agents SDK exposes its own status server; keep it off the control port.
    port: Number(process.env.WORKER_HTTP_PORT ?? 8091),
    production: true,
  }),
)

server.run().catch((err) => {
  console.error("agent worker failed", err)
  process.exit(1)
})
