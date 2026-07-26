import type { TurnGateDecision } from "@meet/shared"

/**
 * The Gemini manual-turn gate, extracted from realtime-agent.ts so the
 * production decision wiring is unit-testable. Gemini can't be gated with a
 * create_response switch the way OpenAI can — instead room audio rolls into
 * a ring buffer and the ONLY way the model ever hears (and answers) a turn
 * is sendBufferedTurn(). This module decides when that happens; if it never
 * calls sendBufferedTurn/notifyChatTurn, the model cannot speak.
 */
export type GeminiGateDeps = {
  /** True while the gate is lifted (open policy or an active zap window). */
  gateOpen: () => boolean
  /** The agent's spoken-name matcher (spokenMentionRegExp). */
  mention: RegExp
  /** The shared turn-policy decision (decideTurn over live state). */
  decide: (mentioned: boolean) => TurnGateDecision
  /** Replay the buffered turn audio to the model; false if the ring was empty. */
  sendBufferedTurn: () => boolean
  /** The transcript-as-turn fallback when the ring was empty. */
  notifyChatTurn: (line: string) => void
  /** Withheld speech surfaced as passive context (can't trigger a response). */
  notifyHeard: (line: string) => void
  /** Out-of-band silent deliberation; resolves with the model's verdict. */
  deliberate: (line: string) => Promise<"pass" | "raise-hand">
  onHandRaise: () => void
  onDecision?: (
    transcript: string,
    decision: TurnGateDecision["action"],
  ) => void
  /** A deliberation finished without raising the hand (badge restore). */
  onDeliberateDone?: () => void
  now?: () => number
}

/** How long a final transcript matches an already-answered early fire. */
const EARLY_FIRE_DEDUPE_MS = 5_000

export function createGeminiGate(deps: GeminiGateDeps) {
  const now = deps.now ?? Date.now
  // Early mention firing: an interim transcript that already contains the
  // agent's name arms the turn, and the local VAD's end-of-speech sends the
  // buffered audio right away — skipping the transcriber's endpoint silence
  // and its finalizer pass, the two big waits in gated mention latency. The
  // matching final is then only deduped, not answered again.
  let pendingMention = false
  let earlyFiredAt = 0

  return {
    /** Local VAD end-of-speech while in manual-turn mode. */
    onEndOfSpeech() {
      if (deps.gateOpen()) {
        deps.sendBufferedTurn()
        return
      }
      if (pendingMention && deps.decide(true).action === "speak") {
        pendingMention = false
        earlyFiredAt = now()
        deps.onDecision?.("(interim mention)", "speak")
        deps.sendBufferedTurn()
      }
    },

    /** A room-transcriber utterance (interim or final) while gated. */
    onUtterance(identity: string, name: string, text: string, final: boolean) {
      if (deps.gateOpen()) return
      // Other agents never grant this one the floor — agent-to-agent audio
      // loops would spiral, same rule as chat mentions.
      if (identity.startsWith("agent-")) return
      if (!final) {
        // Arm the early path only when a mention would actually speak —
        // under raise-hand it wouldn't, and the final raises the hand.
        if (deps.mention.test(text) && deps.decide(true).action === "speak") {
          pendingMention = true
        }
        return
      }
      // The turn is over — an armed mention that never fired (VAD
      // end-of-speech beat the interim) is handled by this final.
      pendingMention = false
      if (
        deps.mention.test(text) &&
        now() - earlyFiredAt < EARLY_FIRE_DEDUPE_MS
      ) {
        // Already answered at end-of-speech; the final is just the polished
        // text of the same turn.
        earlyFiredAt = 0
        return
      }
      const decision = deps.decide(deps.mention.test(text))
      deps.onDecision?.(text, decision.action)
      switch (decision.action) {
        case "speak":
          if (!deps.sendBufferedTurn()) {
            // The ring was empty (flushed, or transcript raced the audio):
            // the transcript itself becomes the turn.
            deps.notifyChatTurn(`${name} said to you: "${text}"`)
          }
          return
        case "raise-hand":
          deps.onHandRaise()
          return
        case "deliberate":
          deps.notifyHeard(`[meeting audio] ${name}: ${text}`)
          // Same silent deliberation OpenAI runs on unaddressed turns: the
          // agent can raise its hand (or drop a chat aside) without being
          // named — otherwise a gated Gemini agent can never self-initiate.
          void deps.deliberate(`${name}: ${text}`).then((verdict) => {
            if (verdict === "raise-hand") deps.onHandRaise()
            else deps.onDeliberateDone?.()
          })
          return
        default:
          return
      }
    },
  }
}
