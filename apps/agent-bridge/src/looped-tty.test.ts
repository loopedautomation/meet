import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WebSocketServer } from "ws"
import { LoopedTtyClient, type TtyServerFrame } from "./looped-tty.js"

let server: WebSocketServer
let port: number
let receivedProtocols: string[] = []

function frames(reply: string): TtyServerFrame[] {
  return [
    { type: "step", n: 1 },
    { type: "tool_call", name: "http", arguments: '{"url":"x"}' },
    { type: "tool_result", name: "http", content: "ok", durationMs: 12 },
    { type: "assistant", content: reply },
    { type: "result", status: "ok", reply, steps: 1 },
  ]
}

beforeEach(async () => {
  server = new WebSocketServer({ port: 0 })
  await new Promise<void>((resolve) => server.once("listening", resolve))
  port = (server.address() as { port: number }).port
  receivedProtocols = []
  server.on("connection", (socket, request) => {
    receivedProtocols.push(request.headers["sec-websocket-protocol"] ?? "")
    socket.send(
      JSON.stringify({
        type: "hello",
        handle: "mock",
        conversation_id: "c1",
      } satisfies TtyServerFrame),
    )
    socket.on("message", (data) => {
      const frame = JSON.parse(String(data)) as { type: string; text: string }
      if (frame.type !== "input") {
        socket.send(JSON.stringify({ type: "error", error: "bad frame" }))
        return
      }
      for (const f of frames(`you said: ${frame.text}`)) {
        socket.send(JSON.stringify(f))
      }
    })
  })
})

afterEach(() => {
  server.close()
})

describe("LoopedTtyClient", () => {
  it("streams a full turn of frames and terminates on result", async () => {
    const client = new LoopedTtyClient({
      url: `ws://127.0.0.1:${port}/tty`,
      token: "secret",
      conversationId: "room-scout",
    })
    const seen: TtyServerFrame[] = []
    for await (const frame of client.runTurn("Alice: hello")) {
      seen.push(frame)
    }
    client.close()

    expect(seen.map((f) => f.type)).toEqual([
      "step",
      "tool_call",
      "tool_result",
      "assistant",
      "result",
    ])
    const assistant = seen.find((f) => f.type === "assistant")
    expect(assistant).toMatchObject({ content: "you said: Alice: hello" })
    expect(receivedProtocols[0]).toBe("bearer.secret")
  })

  it("supports sequential turns on one connection", async () => {
    const client = new LoopedTtyClient({
      url: `ws://127.0.0.1:${port}/tty`,
      token: "secret",
      conversationId: "room-scout",
    })
    for (const input of ["one", "two"]) {
      const types: string[] = []
      for await (const frame of client.runTurn(input)) types.push(frame.type)
      expect(types.at(-1)).toBe("result")
    }
    client.close()
    expect(receivedProtocols).toHaveLength(1)
  })

  it("rejects concurrent turns", async () => {
    const client = new LoopedTtyClient({
      url: `ws://127.0.0.1:${port}/tty`,
      token: "secret",
      conversationId: "room-scout",
    })
    const first = client.runTurn("a")
    await first.next()
    await expect(async () => {
      for await (const _ of client.runTurn("b")) {
        // should throw before yielding
      }
    }).rejects.toThrow(/already in progress/)
    await first.return(undefined)
    client.close()
  })

  it("errors when the connection closes mid-turn", async () => {
    const client = new LoopedTtyClient({
      url: `ws://127.0.0.1:${port}/tty`,
      token: "secret",
      conversationId: "room-scout",
      turnTimeoutMs: 2000,
    })
    // Server that closes immediately after input.
    server.removeAllListeners("connection")
    server.on("connection", (socket) => {
      socket.on("message", () => socket.close())
    })
    await expect(async () => {
      for await (const _ of client.runTurn("boom")) {
        // no frames expected
      }
    }).rejects.toThrow(/closed/)
    client.close()
  })
})
