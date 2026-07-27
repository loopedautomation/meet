// Interactive turn-gate harness: drive the EXACT decision function every
// production path uses (decideTurn in @meet/shared) with typed utterances,
// chat messages and controls, and watch the full decision trace per input.
//
//   pnpm --filter agent-bridge exec tsx scripts/gate-repl.ts --name Scout
//
// Commands:
//   <text>              a spoken utterance heard in the meeting
//   /chat <text>        a meeting chat message
//   /policy <p>         open | on-mention | raise-hand
//   /zap                zap the agent (one-shot grant, 30s deadline)
//   /callon             call on the agent (grants the next turn)
//   /mute /unmute /deafen /undeafen
//   /tick <seconds>     advance the simulated clock
//   /state              show current state
//   /quit
import * as readline from "node:readline"
import {
  decideTurn,
  ENGAGED_WINDOW_MS,
  mentionsName,
  requestsSpeech,
  spokenMentionRegExp,
  type TurnGateDecision,
  type TurnPolicy,
  turnPolicySchema,
  zapActive,
} from "@meet/shared"

const ZAP_WINDOW_MS = 30_000

const name = (() => {
  const i = process.argv.indexOf("--name")
  return i >= 0 ? (process.argv[i + 1] ?? "Scout") : "Scout"
})()

const state = {
  policy: "open" as TurnPolicy,
  muted: false,
  deafened: false,
  callOnPending: false,
  zappedUntil: 0,
  engagedUntil: 0,
  now: 0, // simulated clock, ms
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const color = (s: string, c: number) => `\x1b[${c}m${s}\x1b[0m`

const paintAction = (d: TurnGateDecision) => {
  switch (d.action) {
    case "speak":
      return color(`SPEAK (via ${d.via})`, 32)
    case "reply-in-chat":
      return color("REPLY IN CHAT", 36)
    case "raise-hand":
      return color("RAISE HAND", 33)
    case "deliberate":
      return color("DELIBERATE silently (may chat aside)", 35)
    case "ignore":
      return dim(`IGNORE (${d.reason})`)
  }
}

function showState() {
  const zapLeft = Math.max(0, state.zappedUntil - state.now)
  const engagedLeft = Math.max(0, state.engagedUntil - state.now)
  console.log(
    dim(
      `  policy=${state.policy} muted=${state.muted} deafened=${state.deafened}` +
        ` callOnPending=${state.callOnPending}` +
        ` zap=${zapLeft > 0 ? `${(zapLeft / 1000).toFixed(0)}s left` : "inactive"}` +
        ` engaged=${engagedLeft > 0 ? `${(engagedLeft / 1000).toFixed(0)}s left` : "no"}` +
        ` clock=${(state.now / 1000).toFixed(0)}s`,
    ),
  )
}

function runTurn(channel: "voice" | "chat", text: string) {
  const mentioned =
    channel === "voice"
      ? spokenMentionRegExp(name).test(text)
      : mentionsName(text, name)
  const speakRequested = channel === "chat" ? requestsSpeech(text) : undefined
  const zapped = zapActive(state.zappedUntil, state.now)
  const engaged = zapActive(state.engagedUntil, state.now)
  const decision = decideTurn({
    policy: state.policy,
    channel,
    mentioned,
    speakRequested,
    zapped,
    callOnPending: state.callOnPending,
    engaged,
    muted: state.muted,
    deafened: state.deafened,
  })
  console.log(
    dim(
      `  inputs: mentioned=${mentioned}` +
        (channel === "chat" ? ` speakRequested=${speakRequested}` : "") +
        ` zapped=${zapped} engaged=${engaged} callOnPending=${state.callOnPending}`,
    ),
  )
  console.log(`  → ${paintAction(decision)}`)
  if (decision.action === "speak") {
    if (decision.consumeCallOn) {
      state.callOnPending = false
      console.log(dim("  (call-on consumed)"))
    }
    if (decision.consumeZap) {
      state.zappedUntil = 0
      console.log(dim("  (zap consumed — one-shot grant used, re-gated)"))
    }
    if (
      channel === "voice" &&
      decision.via !== "engaged" &&
      decision.via !== "open"
    ) {
      state.engagedUntil = state.now + ENGAGED_WINDOW_MS
      console.log(
        dim("  (direct address — engaged window open for follow-ups, 20s)"),
      )
    }
  }
}

console.log(bold(`Turn-gate REPL — agent "${name}"`))
console.log(dim("Type an utterance, /chat <text>, or /help. /quit to exit."))
showState()

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
})
rl.prompt()
rl.on("line", (raw) => {
  const line = raw.trim()
  if (!line) {
    rl.prompt()
    return
  }
  if (line.startsWith("/")) {
    const [cmd, ...rest] = line.slice(1).split(/\s+/)
    const arg = rest.join(" ")
    switch (cmd) {
      case "chat":
        runTurn("chat", arg)
        break
      case "policy": {
        const parsed = turnPolicySchema.safeParse(arg)
        if (!parsed.success) {
          console.log("  policy must be: open | on-mention | raise-hand")
          break
        }
        state.policy = parsed.data
        // Same rule as the workers: a policy change ends any grants.
        state.zappedUntil = 0
        state.engagedUntil = 0
        console.log(
          `  policy → ${state.policy} ${dim("(zap/engaged windows cleared)")}`,
        )
        break
      }
      case "zap":
        state.muted = false
        state.deafened = false
        state.zappedUntil = state.now + ZAP_WINDOW_MS
        console.log(
          color("  ⚡ zapped — unmuted/undeafened, next turn answers", 33) +
            dim(" (30s deadline)"),
        )
        break
      case "callon":
        state.callOnPending = true
        console.log("  call-on pending — next turn answers")
        break
      case "mute":
        state.muted = true
        state.zappedUntil = 0
        state.engagedUntil = 0
        console.log(`  muted ${dim("(zap window cleared)")}`)
        break
      case "unmute":
        state.muted = false
        console.log("  unmuted")
        break
      case "deafen":
        state.deafened = true
        state.zappedUntil = 0
        state.engagedUntil = 0
        console.log(`  deafened ${dim("(zap window cleared)")}`)
        break
      case "undeafen":
        state.deafened = false
        console.log("  undeafened")
        break
      case "tick": {
        const s = Number(arg)
        if (!Number.isFinite(s) || s <= 0) {
          console.log("  usage: /tick <seconds>")
          break
        }
        state.now += s * 1000
        console.log(`  ⏱ +${s}s`)
        break
      }
      case "state":
        break
      case "quit":
      case "exit":
        rl.close()
        return
      default:
        console.log(
          "  commands: /chat /policy /zap /callon /mute /unmute /deafen /undeafen /tick /state /quit",
        )
    }
    showState()
    rl.prompt()
    return
  }
  runTurn("voice", line)
  showState()
  rl.prompt()
})
rl.on("close", () => process.exit(0))
