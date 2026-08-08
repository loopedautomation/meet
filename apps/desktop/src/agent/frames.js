// SDK ↔ TTY frame mapping — the adapter seam for Claude Code today, Codex/OpenCode later.

/**
 * Map Claude Agent SDK events to the looped-af TTY frames the gateway pipes verbatim.
 * The worker's LoopedTtyClient expects exactly these shapes.
 */

function sdkToTty(event) {
  // SDK event types are inferred from @anthropic-ai/claude-agent-sdk docs / runtime logs.
  // Minimal mapping covers assistant text, tool use, and result.
  if (!event || typeof event.type !== "string") return null

  switch (event.type) {
    case "assistant": {
      // event.message?.content is an array of blocks
      const content = event.message?.content
      if (Array.isArray(content)) {
        const frames = []
        let textBuf = ""
        let n = 0
        for (const block of content) {
          if (block.type === "text" && block.text) textBuf += block.text
          if (block.type === "tool_use") {
            if (textBuf) { frames.push({ type: "assistant", content: textBuf }); textBuf = "" }
            frames.push({ type: "tool_call", name: block.name ?? block.id ?? "tool", arguments: JSON.stringify(block.input ?? {}) })
          }
        }
        if (textBuf) frames.push({ type: "assistant", content: textBuf })
        // step marker per assistant turn
        frames.unshift({ type: "step", n: n++ })
        return frames
      }
      if (event.text) return [{ type: "assistant", content: event.text }]
      return null
    }
    case "tool_result": {
      return [{ type: "tool_result", name: event.tool_name ?? event.name ?? "tool", content: String(event.content ?? "").slice(0, 4000), durationMs: event.durationMs ?? 0 }]
    }
    case "result": {
      const status = event.is_error ? "error" : "ok"
      return [{ type: "result", status, reply: event.result ?? "", steps: event.num_turns ?? 1 }]
    }
    case "error": {
      return [{ type: "error", error: event.error ?? String(event) }]
    }
    default:
      return null
  }
}

function ttyInputToSdk(text, images) {
  // Inbound {type:"input", text, images?} → one SDK turn.
  // The SDK's query(prompt, {image}) or streaming input iterable expects a string + optional images.
  return { text, images }
}

module.exports = { sdkToTty, ttyInputToSdk }
