import { reviewOpSchema, type ReviewOp } from "@meet/shared/review"
import { MarkerBlockExtractor } from "./doc-blocks.js"

// The pipeline path's review channel, the doc-blocks pattern applied to
// code review: the brain embeds a review op between marker lines, the
// bridge lifts the block out of the spoken reply, validates it against
// the shared op schema, and posts it through the review store. Knowledge
// about reviewing *well* lives in context; this note only makes the
// capability and wire format known.

export const REVIEW_BLOCK_OPEN = "<<<REVIEW"
export const REVIEW_BLOCK_CLOSE = "REVIEW>>>"

/**
 * How a pipeline brain is told it can drive the review. Joined into the
 * meeting context on the first turn, next to DOC_PROTOCOL_NOTE.
 */
export const REVIEW_PROTOCOL_NOTE =
  "You can manage the meeting's code review, which everyone sees live. " +
  `To do so, include a single JSON object describing one review operation between a line containing only ${REVIEW_BLOCK_OPEN} ` +
  `and a line containing only ${REVIEW_BLOCK_CLOSE} anywhere in your reply. Valid ops: ` +
  '{"op":"push-snapshot","snapshot":{…}} (push a PR snapshot — repo, number, title, baseRef, headRef, headSha, files with patches), ' +
  '{"op":"raise-concern","id","anchor?","body","proposed?"} (flag a concern; anchor is {path, side:"old"|"new", line, endLine?, sha}), ' +
  '{"op":"revision-result","id","result":{summary, commits:[{sha,title}], headSha, perConcern:[{concernId,note,newAnchor?}]}} ' +
  '(when a revision is done, mapping each concern to what you changed), ' +
  '{"op":"revision-progress","id","note"} or {"op":"revision-failed","id","error"}. ' +
  "Only one op per block, but you may include multiple blocks in one reply. " +
  "The block is applied, not spoken; any text outside it is spoken as usual — never mention the markers aloud."

/** The review channel's extractor: same mechanics, its own markers. */
export class ReviewBlockExtractor extends MarkerBlockExtractor {
  constructor() {
    super(REVIEW_BLOCK_OPEN, REVIEW_BLOCK_CLOSE)
  }
}

/**
 * A lifted review block, parsed and validated. Errors come back as prose
 * because their audience is the brain (via the activity feed and next-turn
 * context), which can rephrase and try again.
 */
export function parseReviewBlock(
  block: string,
): { op: ReviewOp } | { error: string } {
  const attempt = (text: string): { value: unknown } | { failure: Error } => {
    try {
      return { value: JSON.parse(text) }
    } catch (err) {
      return { failure: err as Error }
    }
  }
  let result = attempt(block)
  if ("failure" in result) {
    result = attempt(block.replace(/,\s*([\]}])/g, "$1"))
  }
  if ("failure" in result) {
    const at = /position (\d+)/.exec(result.failure.message)?.[1]
    const pos = at ? Number(at) : null
    const near =
      pos !== null
        ? ` near "…${block.slice(Math.max(0, pos - 20), pos + 20)}…"`
        : ""
    return {
      error: `The review block wasn't valid JSON${near}. Send a single JSON object with an "op" field.`,
    }
  }
  const raw = result.value
  const parsed = reviewOpSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      error: `The review block was invalid (${issue?.path.join(".")}: ${issue?.message}).`,
    }
  }
  return { op: parsed.data }
}
