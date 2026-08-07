import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebSocketServer } from "ws"
import { isExternalId, normalizeAgentUrl, probeAgent } from "./dynamic.js"

describe("isExternalId", () => {
  it("recognizes ext- ids and nothing else", () => {
    expect(isExternalId("ext-1a2b3c4d")).toBe(true)
    expect(isExternalId("dyn-1a2b3c4d")).toBe(false)
    expect(isExternalId("scout")).toBe(false)
  })
})

describe("dynamic agent store", () => {
  // The store file path is read at module load, so each test gets a fresh
  // module instance pointed at its own temp file.
  let dyn: typeof import("./dynamic.js")
  let file: string

  beforeEach(async () => {
    file = path.join(mkdtempSync(path.join(tmpdir(), "dyn-test-")), "dyn.json")
    process.env.DYNAMIC_AGENTS_FILE = file
    vi.resetModules()
    dyn = await import("./dynamic.js")
  })

  afterEach(() => {
    delete process.env.DYNAMIC_AGENTS_FILE
    vi.resetModules()
  })

  const spec = (name: string) => ({
    url: "wss://bot.example.com/tty",
    token: "secret",
    name,
  })

  it("upserts under a stable caller-chosen id", () => {
    dyn.putDynamicAgent("ext-1a2b3c4d", spec("Scout"))
    expect(dyn.getDynamicAgent("ext-1a2b3c4d")?.name).toBe("Scout")
    dyn.putDynamicAgent("ext-1a2b3c4d", spec("Scout v2"))
    expect(dyn.getDynamicAgent("ext-1a2b3c4d")?.name).toBe("Scout v2")
    // Still exactly one entry — the id never changed.
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")))).toEqual([
      "ext-1a2b3c4d",
    ])
  })

  it("refreshes the timestamp on every put", () => {
    dyn.putDynamicAgent("ext-1a2b3c4d", spec("Scout"))
    const first = JSON.parse(readFileSync(file, "utf8"))["ext-1a2b3c4d"].at
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 60_000)
    dyn.putDynamicAgent("ext-1a2b3c4d", spec("Scout"))
    vi.useRealTimers()
    const second = JSON.parse(readFileSync(file, "utf8"))["ext-1a2b3c4d"].at
    expect(second).toBeGreaterThan(first)
  })

  it("sweeps expired dyn- entries but never ext- entries", () => {
    const stale = Date.now() - 25 * 60 * 60 * 1000
    writeFileSync(
      file,
      JSON.stringify({
        "dyn-old": { ...spec("Old"), at: stale },
        "ext-1a2b3c4d": { ...spec("Durable"), at: stale },
      }),
    )
    // Any write triggers the sweep.
    dyn.registerDynamicAgent(spec("Fresh"))
    expect(dyn.getDynamicAgent("dyn-old")).toBeNull()
    expect(dyn.getDynamicAgent("ext-1a2b3c4d")?.name).toBe("Durable")
  })
})

describe("normalizeAgentUrl", () => {
  it("turns a bare domain into a wss tty url", () => {
    expect(normalizeAgentUrl("gh-issues-bot.lpd.sh")).toBe(
      "wss://gh-issues-bot.lpd.sh/tty",
    )
  })

  it("maps http(s) schemes to websocket equivalents", () => {
    expect(normalizeAgentUrl("https://bot.example.com")).toBe(
      "wss://bot.example.com/tty",
    )
    expect(normalizeAgentUrl("http://localhost:8300")).toBe(
      "ws://localhost:8300/tty",
    )
  })

  it("keeps explicit paths and ws urls untouched", () => {
    expect(normalizeAgentUrl("ws://demo-agent:8300/tty")).toBe(
      "ws://demo-agent:8300/tty",
    )
    expect(normalizeAgentUrl("wss://bot.example.com/custom/path")).toBe(
      "wss://bot.example.com/custom/path",
    )
  })

  it("rejects garbage and non-web schemes", () => {
    expect(normalizeAgentUrl("")).toBeNull()
    expect(normalizeAgentUrl("   ")).toBeNull()
    expect(normalizeAgentUrl("ftp://bot.example.com")).toBeNull()
    expect(normalizeAgentUrl("not a url")).toBeNull()
  })
})

describe("probeAgent", () => {
  let server: WebSocketServer
  let url: string
  // The hello frame the mock agent sends on connect; each test sets it.
  let hello: Record<string, unknown>

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 })
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const port = (server.address() as { port: number }).port
    url = `ws://127.0.0.1:${port}/tty`
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(hello))
    })
  })

  afterEach(() => {
    server.close()
  })

  it("reads the agent's name and description from the hello frame", async () => {
    hello = {
      type: "hello",
      handle: "scout",
      conversation_id: "c1",
      name: "Scout",
      description: "Answers questions about the codebase.",
    }
    expect(await probeAgent(url, "")).toEqual({
      name: "Scout",
      description: "Answers questions about the codebase.",
    })
  })

  it("falls back to the handle when the agent sends no name", async () => {
    hello = { type: "hello", handle: "scout", conversation_id: "c1" }
    expect(await probeAgent(url, "")).toEqual({ name: "scout" })
  })

  it("omits a blank description rather than reporting an empty one", async () => {
    hello = {
      type: "hello",
      handle: "scout",
      conversation_id: "c1",
      name: "Scout",
      description: "   ",
    }
    expect(await probeAgent(url, "")).toEqual({ name: "Scout" })
  })

  it("uses a last-resort name when the agent identifies as neither", async () => {
    hello = { type: "hello", conversation_id: "c1" }
    expect(await probeAgent(url, "")).toEqual({ name: "Agent" })
  })
})
