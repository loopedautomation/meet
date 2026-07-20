import { describe, expect, it } from "vitest"
import { normalizeAgentUrl } from "./dynamic.js"

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
