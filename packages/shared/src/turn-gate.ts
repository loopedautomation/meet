import type { TurnPolicy } from "./index"

// ---- turn gating -----------------------------------------------------------
// The single source of truth for "may this agent respond, and how". Every
// path that gates a turn — the pipeline llmNode, the OpenAI realtime session,
// the Gemini manual-turn gate, and the chat handlers — feeds its inputs
// through decideTurn so the three policies can never drift apart again.

export type TurnChannel = "voice" | "chat"

export type TurnGateInput = {
  policy: TurnPolicy
  channel: TurnChannel
  /** The turn contains this agent's name (spoken or chat mention). */
  mentioned: boolean
  /** Chat only: the message explicitly asks the agent to answer aloud. */
  speakRequested?: boolean
  /** Inside an active zap window — compute with zapActive(). */
  zapped: boolean
  /** A participant called on the hand-raised agent. */
  callOnPending: boolean
  muted: boolean
  deafened: boolean
}

export type TurnGateDecision =
  | {
      action: "speak"
      via: "open" | "mention" | "zap" | "call-on" | "chat-mention"
      /** Caller must clear state.callOnPending. */
      consumeCallOn: boolean
      /** Caller must clear state.zappedUntil — zap is a one-shot grant. */
      consumeZap: boolean
    }
  | { action: "reply-in-chat" }
  | { action: "raise-hand" }
  | { action: "deliberate"; mayChat: true }
  | { action: "ignore"; reason: "deafened" | "not-addressed" }

/** Is a zap window currently open? */
export function zapActive(zappedUntil: number, now = Date.now()): boolean {
  return now < zappedUntil
}

/**
 * Does a chat message explicitly ask the agent to answer ALOUD rather than
 * in chat? Deliberately conservative: a false positive makes an agent talk
 * over a meeting, a false negative just keeps the reply in chat. A small
 * heuristic today; an LLM classifier can replace it behind the same
 * signature if it misfires in practice.
 */
export function requestsSpeech(text: string): boolean {
  return /\b(?:out\s+loud|aloud|verbally|speak\s+(?:up|to\s+us|on\s+this)|say\s+(?:it|this|that|something|so)\s*(?:out\s+loud|aloud|to\s+us)?|use\s+your\s+voice|tell\s+(?:us|everyone)\s+(?:out\s+loud|aloud|verbally))\b/i.test(
    text,
  )
}

/**
 * Decide what an agent may do with a turn it just heard (voice) or a chat
 * message that mentions it (chat).
 *
 * Voice semantics:
 * - open: always speak.
 * - on-mention: speak only when mentioned, zapped, or called on.
 * - raise-hand: speak only when called on or zapped (a zap is an explicit
 *   human summons and outranks the mention-only-raises-hand rule); a bare
 *   mention raises the hand; everything else deliberates silently.
 *
 * Chat semantics (mention is the call sites' precondition):
 * - A chat mention always earns a chat reply — chat is a side channel and
 *   is never hard-gated — UNLESS the message asks the agent to speak.
 * - speakRequested under raise-hand raises the hand instead of speaking.
 * - Under on-mention, a chat mention may be answered aloud (prefaced as a
 *   response to the chat); muted agents fall back to a chat reply.
 *
 * Zap is one-shot: a `speak` decision with consumeZap true means the caller
 * clears the window after committing the response.
 */
export function decideTurn(input: TurnGateInput): TurnGateDecision {
  if (input.channel === "chat") return decideChat(input)

  if (input.deafened) return { action: "ignore", reason: "deafened" }
  if (input.policy === "open") {
    return {
      action: "speak",
      via: "open",
      consumeCallOn: input.callOnPending,
      consumeZap: false,
    }
  }
  if (input.callOnPending) {
    return {
      action: "speak",
      via: "call-on",
      consumeCallOn: true,
      consumeZap: false,
    }
  }
  if (input.zapped) {
    return {
      action: "speak",
      via: "zap",
      consumeCallOn: false,
      consumeZap: true,
    }
  }
  if (input.mentioned) {
    if (input.policy === "raise-hand") return { action: "raise-hand" }
    return {
      action: "speak",
      via: "mention",
      consumeCallOn: false,
      consumeZap: false,
    }
  }
  return { action: "deliberate", mayChat: true }
}

function decideChat(input: TurnGateInput): TurnGateDecision {
  if (!input.mentioned) return { action: "ignore", reason: "not-addressed" }
  if (input.speakRequested) {
    if (input.policy === "raise-hand") return { action: "raise-hand" }
    // Muted and deafened agents answer in chat — the deafen contract says
    // chat mentions still get through, but not that the agent talks aloud
    // over a meeting it can't hear.
    if (input.muted || input.deafened) return { action: "reply-in-chat" }
    return {
      action: "speak",
      via: "chat-mention",
      consumeCallOn: false,
      consumeZap: false,
    }
  }
  // A plain chat mention under on-mention may be answered aloud — the agent
  // notes it's responding to the chat message. Open agents are already in
  // the spoken conversation, and raise-hand agents keep the floor rule:
  // both reply in chat.
  if (input.policy === "on-mention" && !input.muted && !input.deafened) {
    return {
      action: "speak",
      via: "chat-mention",
      consumeCallOn: false,
      consumeZap: false,
    }
  }
  return { action: "reply-in-chat" }
}
