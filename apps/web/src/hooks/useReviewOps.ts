"use client"
import { useDataChannel } from "@livekit/components-react"
import { DataTopic } from "@meet/shared"
import type { ReviewOp } from "@meet/shared/review"
import { useCallback } from "react"
import { fetchReviewState, postReviewOp } from "@/stores/review"

/**
 * The one way components mutate the review: post the op over HTTP (the
 * route stamps the actor from our LiveKit token), then — because the route
 * isn't in the room and the bridge store doesn't broadcast — WE tell the
 * room, on DataTopic.Review. That ping is what makes other participants
 * refetch and, for dispatch-revision, what wakes the executing agent's
 * worker. Finally refetch locally so the actor sees their change without
 * waiting for their own ping to loop back.
 */
export function useReviewOps(slug: string) {
  const { send } = useDataChannel(DataTopic.Review)

  const postOp = useCallback(
    async (
      op: ReviewOp,
    ): Promise<{ ok: boolean; rev?: number; error?: string }> => {
      const result = await postReviewOp(slug, op)
      if (result.ok && typeof result.rev === "number") {
        const ping = {
          type: "review-sync" as const,
          rev: result.rev,
          opKind: op.op,
          ...(op.op === "dispatch-revision"
            ? { revisionId: op.id, agentId: op.agentId }
            : {}),
        }
        void send(new TextEncoder().encode(JSON.stringify(ping)), {
          reliable: true,
        })
        void fetchReviewState(slug)
      }
      return result
    },
    [slug, send],
  )

  return { postOp }
}
