import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WebSocketServer } from "ws"
import { normalizeAgentUrl, probeAgent } from "./dynamic.js"

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
