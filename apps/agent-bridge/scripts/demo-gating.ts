// Non-interactive demonstration of the turn-gate semantics: runs a scripted
// meeting transcript through decideTurn (the exact function all three
// production paths call) under each policy and prints the decision table.
//
//   pnpm --filter agent-bridge exec tsx scripts/demo-gating.ts
import {
  decideTurn,
  mentionsName,
  requestsSpeech,
  spokenMentionRegExp,
  type TurnGateDecision,
  type TurnPolicy,
  zapActive,
} from "@meet/shared"

const NAME = "Scout"
const ZAP_WINDOW_MS = 30_000

type Step =
  | { kind: "voice" | "chat"; text: string }
  | { kind: "zap" | "call-on" | "tick30" }

const script: Step[] = [
  { kind: "voice", text: "So the deploy is failing on staging again." },
  { kind: "voice", text: "Scout, what do you think is causing it?" },
  { kind: "voice", text: "Anyway, let's talk about the roadmap." },
  { kind: "zap" },
  { kind: "voice", text: "Right, where were we?" },
  { kind: "voice", text: "This one is right after the zap was consumed." },
  { kind: "zap" },
  { kind: "tick30" },
  { kind: "voice", text: "This one arrives after the zap window expired." },
  { kind: "call-on" },
  { kind: "voice", text: "Go ahead." },
  { kind: "chat", text: `@${NAME} can you post the error log link?` },
  { kind: "chat", text: `@${NAME} tell us out loud what you found` },
]

const label = (d: TurnGateDecision) =>
  d.action === "speak"
    ? `SPEAK via ${d.via}${d.consumeZap ? " (zap consumed)" : ""}${d.consumeCallOn ? " (call-on consumed)" : ""}`
    : d.action === "deliberate"
      ? "deliberate silently"
      : d.action === "reply-in-chat"
        ? "reply in chat"
        : d.action === "raise-hand"
          ? "RAISE HAND"
          : `ignore (${d.reason})`

for (const policy of ["open", "on-mention", "raise-hand"] as TurnPolicy[]) {
  console.log(`\n━━━ policy: ${policy} ${"━".repeat(50 - policy.length)}`)
  let now = 0
  let zappedUntil = 0
  let callOnPending = false
  for (const step of script) {
    if (step.kind === "zap") {
      zappedUntil = now + ZAP_WINDOW_MS
      console.log("  ⚡ ZAP (one-shot grant, 30s deadline)")
      continue
    }
    if (step.kind === "call-on") {
      callOnPending = true
      console.log("  👉 CALL-ON")
      continue
    }
    if (step.kind === "tick30") {
      now += ZAP_WINDOW_MS
      console.log("  ⏱ 30 seconds pass")
      continue
    }
    const decision = decideTurn({
      policy,
      channel: step.kind,
      mentioned:
        step.kind === "voice"
          ? spokenMentionRegExp(NAME).test(step.text)
          : mentionsName(step.text, NAME),
      speakRequested: step.kind === "chat" ? requestsSpeech(step.text) : undefined,
      zapped: zapActive(zappedUntil, now),
      callOnPending,
      muted: false,
      deafened: false,
    })
    if (decision.action === "speak") {
      if (decision.consumeZap) zappedUntil = 0
      if (decision.consumeCallOn) callOnPending = false
    }
    const chan = step.kind === "chat" ? "chat " : "voice"
    console.log(`  [${chan}] "${step.text}"`)
    console.log(`          → ${label(decision)}`)
  }
}
console.log(
  "\nInvariants demonstrated: gated agents never SPEAK unaddressed; " +
    "raise-hand mentions only raise the hand; zap answers exactly one turn; " +
    "expired zaps grant nothing; chat mentions reply in chat unless a spoken " +
    "answer is explicitly requested (raise-hand raises the hand instead).\n",
)
