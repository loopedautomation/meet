import type { JobContext } from "@livekit/agents"
import type { RemoteParticipant } from "@livekit/rtc-node"
import {
  AGENT_CHATTINESS_ATTRIBUTE,
  AGENT_POLICY_ATTRIBUTE,
  AGENT_STATE_ATTRIBUTE,
  type AgentActivityEvent,
  type ChatMessage,
  DataTopic,
  readSharedDoc,
  Y,
} from "@meet/shared"
import type { ReviewOp } from "@meet/shared/review"
import { collectBrainReply } from "./brain-reply.js"
import { extractLeaveMarker, LEAVE_PROTOCOL_NOTE } from "./doc-blocks.js"
import type { Brain } from "./looped-webhook.js"
import {
  describeRoster,
  fetchReviewState,
  fetchTranscript,
  formatReview,
  formatSharedDoc,
  formatTranscript,
  postDebugEvent,
  postReviewOp,
  pushBounded,
  REVIEW_PROTOCOL_NOTE,
  requestAgentRemoval,
  seedSharedDoc,
  withMeetingContext,
} from "./meeting-context.js"
import { parseReviewBlock, ReviewBlockExtractor } from "./review-blocks.js"

// The local agent's room body: text-only presence for the review loop.
// Same brain transport as every other agent (TTY frames over the gateway
// relay), no voice pipeline — revisions run minutes, and the review panel
// and chat are the surfaces that matter. Voice later is a mode flip on the
// same connection; nothing here would change.

type TextAgentEntry = {
  id: string
  name: string
  chattiness: string
}

/** Runs until the room closes or the agent is removed. */
export async function runTextAgent(
  ctx: JobContext,
  entry: TextAgentEntry,
  rawBrain: Brain,
  roomName: string,
): Promise<void> {
  const local = ctx.room.localParticipant
  if (!local) throw new Error("no local participant after connect")
  const agentActor = {
    identity: `agent-${entry.id}`,
    name: entry.name,
    kind: "agent" as const,
  }

  await local
    .setAttributes({
      [AGENT_STATE_ATTRIBUTE]: "listening",
      [AGENT_POLICY_ATTRIBUTE]: "open",
      [AGENT_CHATTINESS_ATTRIBUTE]: entry.chattiness,
    })
    .catch(() => undefined)

  const publish = (topic: string, payload: unknown) =>
    local
      .publishData(new TextEncoder().encode(JSON.stringify(payload)), {
        reliable: true,
        topic,
      })
      .catch(() => undefined)

  const publishActivity = (event: AgentActivityEvent) =>
    publish(DataTopic.AgentActivity, event)
  const setState = (state: "listening" | "thinking") =>
    local
      .setAttributes({ [AGENT_STATE_ATTRIBUTE]: state })
      .catch(() => undefined)
  const setTyping = (typing: boolean) =>
    publishActivity({
      type: "typing",
      agentId: entry.id,
      typing,
      at: Date.now(),
    })

  // ---- meeting context ------------------------------------------------------
  const docYDoc = new Y.Doc()
  await seedSharedDoc(roomName, docYDoc)
  const priorTranscript = formatTranscript(await fetchTranscript(roomName))
  const priorDoc = formatSharedDoc(readSharedDoc(docYDoc))
  const priorReview = formatReview(await fetchReviewState(roomName))
  const meetingContext = [
    `Participants in the meeting when you joined: ${describeRoster(ctx.room)}.`,
    "You are a developer's local coding agent, joined to this meeting to review code. You have the repository, git and gh on their machine — when asked to load a PR, run gh locally and push a snapshot.",
    priorDoc,
    priorReview ? `Code review in progress:\n${priorReview}` : "",
    priorTranscript
      ? `Transcript of the meeting before you joined:\n${priorTranscript}`
      : "",
    REVIEW_PROTOCOL_NOTE,
    LEAVE_PROTOCOL_NOTE,
  ]
    .filter(Boolean)
    .join("\n\n")

  // Chat the brain hasn't seen (messages that didn't trigger a turn), plus
  // outcomes of its own review blocks — both drained into the next turn.
  const chatSince: string[] = []
  const reviewOutcomes: string[] = []
  const brain = withMeetingContext(rawBrain, meetingContext, () => {
    const parts: string[] = []
    const outcomes = reviewOutcomes.splice(0)
    if (outcomes.length)
      parts.push(
        `[Review results from your last turn:]\n${outcomes.join("\n")}`,
      )
    const lines = chatSince.splice(0)
    if (lines.length)
      parts.push(`[Meeting chat since your last turn:]\n${lines.join("\n")}`)
    return parts.join("\n\n")
  })

  postDebugEvent(roomName, `agent:${entry.id}`, "info", "joined (text mode)")

  const broadcastSync = (
    rev: number,
    opKind: string,
    revisionId?: string,
  ): void => {
    void publish(DataTopic.Review, {
      type: "review-sync",
      rev,
      opKind,
      ...(revisionId ? { revisionId } : {}),
      agentId: entry.id,
    })
  }

  /** Post one review op from the brain; outcome rides into its next turn. */
  const applyReviewOpFromBrain = async (op: ReviewOp): Promise<boolean> => {
    const result = await postReviewOp(roomName, { actor: agentActor, op })
    if (result.ok) {
      if (typeof result.rev === "number")
        broadcastSync(result.rev, op.op, "id" in op ? op.id : undefined)
      pushBounded(reviewOutcomes, `${op.op}: applied (rev ${result.rev}).`)
    } else {
      pushBounded(
        reviewOutcomes,
        `${op.op}: rejected — ${result.error ?? "unknown error"}. Fix and retry.`,
      )
    }
    publishActivity({
      type: "tool_result",
      agentId: entry.id,
      name: "review",
      content: result.ok
        ? `${op.op} ok (rev ${result.rev})`
        : `${op.op} failed: ${result.error}`,
      durationMs: 0,
      at: Date.now(),
    })
    return result.ok
  }

  /**
   * One brain turn: stream activity, lift <<<REVIEW>>> blocks and the leave
   * marker out of the reply, post what remains to chat. Returns the ops
   * that were applied so callers (the revision path) can check for results.
   */
  const runTurn = async (
    input: string,
  ): Promise<{ appliedOps: ReviewOp[] }> => {
    setState("thinking")
    setTyping(true)
    const appliedOps: ReviewOp[] = []
    try {
      const reply = await collectBrainReply(brain.runTurn(input), (frame) => {
        const at = Date.now()
        if (frame.type === "tool_call") {
          publishActivity({
            type: "tool_call",
            agentId: entry.id,
            name: frame.name,
            arguments: frame.arguments,
            at,
          })
        } else if (frame.type === "tool_result") {
          publishActivity({
            type: "tool_result",
            agentId: entry.id,
            name: frame.name,
            content: frame.content.slice(0, 8000),
            durationMs: frame.durationMs,
            at,
          })
        } else if (frame.type === "step") {
          publishActivity({ type: "step", agentId: entry.id, n: frame.n, at })
        }
      })

      const extractor = new ReviewBlockExtractor()
      const { spoken, blocks } = extractor.feed(reply)
      for (const block of blocks) {
        const parsed = parseReviewBlock(block)
        if ("error" in parsed) {
          pushBounded(reviewOutcomes, parsed.error)
          publishActivity({
            type: "tool_result",
            agentId: entry.id,
            name: "review",
            content: parsed.error,
            durationMs: 0,
            at: Date.now(),
          })
          continue
        }
        if (await applyReviewOpFromBrain(parsed.op)) appliedOps.push(parsed.op)
      }

      const { text, leave } = extractLeaveMarker(spoken)
      const chatText = text.trim()
      if (chatText) {
        const message: ChatMessage = {
          id: `${entry.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          from: `agent-${entry.id}`,
          fromName: entry.name,
          text: chatText.slice(0, 8000),
          at: Date.now(),
        }
        await publish(DataTopic.Chat, message)
      }
      if (leave) {
        await requestAgentRemoval(roomName, entry.id)
      }
    } catch (err) {
      postDebugEvent(
        roomName,
        `agent:${entry.id}`,
        "error",
        `turn failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      throw err
    } finally {
      setTyping(false)
      setState("listening")
    }
    return { appliedOps }
  }

  // ---- chat -> turns --------------------------------------------------------
  const isSoleAgent = () => {
    for (const p of ctx.room.remoteParticipants.values()) {
      if (p.identity.startsWith("agent-")) return false
    }
    return true
  }
  const mentionsMe = (text: string) => {
    const lower = text.toLowerCase()
    return lower.includes(entry.name.toLowerCase()) || lower.includes("@claude")
  }

  const onChat = (message: ChatMessage, sender: string) => {
    // Never converse with other agents — two text agents answering each
    // other is an unbounded loop. Humans only.
    if (sender.startsWith("agent-")) return
    const line = `${message.fromName}: ${message.text}`
    if (isSoleAgent() || mentionsMe(message.text)) {
      void runTurn(
        `${message.fromName} (in the meeting chat — reply concisely, your reply appears in the chat): ${message.text}`,
      ).catch(() => undefined)
    } else {
      // Someone else's conversation — context for the next turn, not a turn.
      pushBounded(chatSince, line)
    }
  }

  // ---- dispatch -> revision turns ------------------------------------------
  const onReviewSync = (raw: {
    type?: string
    opKind?: string
    agentId?: string
    revisionId?: string
  }) => {
    if (
      raw?.type !== "review-sync" ||
      raw.opKind !== "dispatch-revision" ||
      !raw.revisionId
    )
      return
    if (raw.agentId !== entry.id && raw.agentId !== `agent-${entry.id}`) return
    void runRevision(String(raw.revisionId)).catch(() => undefined)
  }

  const runRevision = async (revisionId: string): Promise<void> => {
    const state = await fetchReviewState(roomName)
    const revision = state?.revisions.find((r) => r.id === revisionId)
    if (!state || !revision) return

    const progress = await postReviewOp(roomName, {
      actor: agentActor,
      op: { op: "revision-progress", id: revisionId, note: "started" },
    })
    if (progress.ok && typeof progress.rev === "number")
      broadcastSync(progress.rev, "revision-progress", revisionId)

    const pr = state.pr
    const concernLines = revision.concernIds
      .map((id, i) => {
        const concern = state.concerns.find((c) => c.id === id)
        if (!concern) return `${i + 1}. (${id})`
        const anchor = concern.anchor
          ? `${concern.anchor.path}:${concern.anchor.line}`
          : "PR-level"
        const note = concern.decision?.note
          ? ` — decision note: ${concern.decision.note}`
          : ""
        return `${i + 1}. (id ${concern.id}, ${anchor}) ${concern.body}${note}`
      })
      .join("\n")
    const prompt =
      `[revision-request ${revisionId}] You are asked to revise ` +
      (pr
        ? `PR #${pr.number} in ${pr.repo} ("${pr.title}") on branch ${pr.headRef}.`
        : "the pull request under review.") +
      `\nAddress these agreed concerns, commit to the branch, and push:\n${concernLines}\n` +
      `Instruction from the meeting: ${revision.instruction}\n` +
      `When done, reply with a <<<REVIEW ... REVIEW>>> block containing the revision-result op ` +
      `(id "${revisionId}", mapping each concern id to what you changed), then another block ` +
      `with a push-snapshot op carrying the refreshed PR.`

    try {
      const { appliedOps } = await runTurn(prompt)
      const reportedResult = appliedOps.some(
        (op) => op.op === "revision-result" && op.id === revisionId,
      )
      if (!reportedResult) {
        const failed = await postReviewOp(roomName, {
          actor: agentActor,
          op: {
            op: "revision-failed",
            id: revisionId,
            error: "the agent finished without a revision-result block",
          },
        })
        if (failed.ok && typeof failed.rev === "number")
          broadcastSync(failed.rev, "revision-failed", revisionId)
      }
    } catch (err) {
      const failed = await postReviewOp(roomName, {
        actor: agentActor,
        op: {
          op: "revision-failed",
          id: revisionId,
          error: (err instanceof Error
            ? err.message
            : "agent disconnected"
          ).slice(0, 1000),
        },
      })
      if (failed.ok && typeof failed.rev === "number")
        broadcastSync(failed.rev, "revision-failed", revisionId)
    }
  }

  // ---- wiring ---------------------------------------------------------------
  ctx.room.on(
    "dataReceived",
    (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ) => {
      const sender = participant?.identity ?? ""
      if (sender === local.identity) return
      try {
        const raw = JSON.parse(new TextDecoder().decode(payload))
        if (topic === DataTopic.Chat) {
          if (raw && typeof raw.text === "string" && typeof raw.id === "string")
            onChat(raw as ChatMessage, sender)
        } else if (topic === DataTopic.Review) {
          onReviewSync(raw)
        }
      } catch {
        // not JSON — not ours
      }
    },
  )

  // Belt and braces: a dispatch posted while this worker was starting (or
  // whose ping was lost) is picked up on join.
  const pending = (await fetchReviewState(roomName))?.revisions.filter(
    (r) => r.agentId === entry.id && r.status === "dispatched",
  )
  for (const revision of pending ?? []) {
    void runRevision(revision.id).catch(() => undefined)
  }

  await new Promise<void>((resolve) => {
    ctx.room.on("disconnected", () => resolve())
  })
  postDebugEvent(roomName, `agent:${entry.id}`, "info", "left the room")
}
