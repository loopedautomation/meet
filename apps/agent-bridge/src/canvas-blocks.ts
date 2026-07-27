import { type CanvasOp, canvasOpBatchSchema } from "@meet/shared"
import { MarkerBlockExtractor } from "./doc-blocks.js"

// The pipeline path's whiteboard channel, the doc-blocks pattern applied to
// drawing: the brain embeds a JSON array of canvas ops between marker lines,
// the bridge lifts the block out of the spoken reply, validates it against
// the shared op schema, and runs it through the same publish path the
// realtime draw_on_canvas tool uses. Knowledge about drawing *well* lives in
// the whiteboard skill (skills/whiteboard.md); this note only makes the
// capability and wire format known to brains that don't carry the skill.

export const CANVAS_BLOCK_OPEN = "<<<CANVAS"
export const CANVAS_BLOCK_CLOSE = "CANVAS>>>"

/**
 * How a pipeline brain is told it can draw. Joined into the meeting context
 * on the first turn, next to DOC_PROTOCOL_NOTE. Deliberately compact: the
 * full vocabulary with examples is skill material, and agents that carry the
 * whiteboard skill are told to read it.
 */
export const CANVAS_PROTOCOL_NOTE =
  "You can draw on the meeting's shared whiteboard, which everyone sees " +
  `live. To do so, include a JSON array of drawing operations between a line ` +
  `containing only ${CANVAS_BLOCK_OPEN} and a line containing only ` +
  `${CANVAS_BLOCK_CLOSE} anywhere in your reply. Operations (applied in ` +
  'order): {"op":"rect"|"ellipse","id","x?","y?","w","h","label?","color?",' +
  '"fill?":"none"|"semi"|"solid"|"hatch","stroke?":"solid"|"dashed"|' +
  '"dotted","strokeWidth?":"thin"|"medium"|"bold"}, ' +
  '{"op":"text","id","x?","y?","text",' +
  '"size?":"s"|"m"|"l"|"xl"}, {"op":"note","id","x?","y?","text","color?"}, ' +
  '{"op":"arrow","id","from?","to?","label?"} (from/to are shape ids), ' +
  '{"op":"move","id","x","y"} or {"op":"move","id","dx","dy"} (relative ' +
  'nudge), {"op":"update","id","label?","text?",' +
  '"color?","w?","h?","fill?","stroke?","strokeWidth?"} (restyle or ' +
  'resize anything in place), {"op":"delete","id"}, {"op":"clear"}, ' +
  '{"op":"diagram","id","mermaid"} (Mermaid flowchart source, for when ' +
  "someone explicitly wants a flowchart/sequence rendered from Mermaid; " +
  'node ids become "<id>.<node>", and re-sending the same diagram id with ' +
  "edited source updates it IN PLACE). DEFAULT to the primitive ops, not " +
  "diagram: OMIT x/y on creates and layout is automatic — arrow-connected " +
  "shapes are arranged as a clean graph, everything else lands clear of " +
  "existing shapes. Only give coordinates for deliberate geometry (charts, " +
  "timelines, aligned bars: page pixels on roughly 1600x1000, y growing " +
  "downward). BE AMBITIOUS: a real diagram of a system or plan has 8-15 " +
  "labeled shapes with labeled arrows, groups shown as proximity, and " +
  "notes for caveats — not three boxes. Use your own domain knowledge to " +
  "fill in the real component names and relationships being discussed. " +
  "Keep every label under ~30 characters (labels wrap and shrink to fit, " +
  "but short labels read best); put longer explanations in a note. Color " +
  "is automatic — unstyled shapes get distinct palette colors — so only " +
  "set color to MEAN something (e.g. red for failure paths, green for " +
  "healthy, one color per subsystem); never produce a deliberately " +
  "monochrome board. Give every shape a short memorable id so you can " +
  "connect, move or update it later. If you have a whiteboard skill, read " +
  "it before drawing. The block is drawn, not spoken; any text outside it " +
  "is spoken as usual — never mention coordinates or ids aloud."

/** The whiteboard channel's extractor: same mechanics, its own markers. */
export class CanvasBlockExtractor extends MarkerBlockExtractor {
  constructor() {
    super(CANVAS_BLOCK_OPEN, CANVAS_BLOCK_CLOSE)
  }
}

/**
 * A lifted canvas block, parsed and validated. Errors come back as prose
 * because their audience is the brain (via the activity feed and next-turn
 * context), which can rephrase its batch and try again.
 */
export function parseCanvasBlock(
  block: string,
): { ops: CanvasOp[] } | { error: string } {
  const attempt = (text: string): { value: unknown } | { failure: Error } => {
    try {
      return { value: JSON.parse(text) }
    } catch (err) {
      return { failure: err as Error }
    }
  }
  let result = attempt(block)
  if ("failure" in result) {
    // Trailing commas are the most common model slip, and stripping one
    // before a closing bracket can never change valid JSON's meaning.
    result = attempt(block.replace(/,\s*([\]}])/g, "$1"))
  }
  if ("failure" in result) {
    // Point at the breakage — "wasn't valid JSON" alone gives a retrying
    // model nothing to change.
    const at = /position (\d+)/.exec(result.failure.message)?.[1]
    const pos = at ? Number(at) : null
    const near =
      pos !== null
        ? ` near “…${block.slice(Math.max(0, pos - 20), pos + 20)}…”`
        : ""
    return {
      error: `The canvas block wasn't valid JSON${near}. Send a JSON array of op objects.`,
    }
  }
  let raw = result.value
  // A single op object is unmistakable intent — accept it as a batch of one.
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "op" in raw) {
    raw = [raw]
  }
  const parsed = canvasOpBatchSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const hint = issue?.message.includes("<=50")
      ? " Split large drawings into several blocks of at most 50 ops."
      : ""
    return {
      error: `The canvas block was invalid (${issue?.path.join(".")}: ${issue?.message}).${hint}`,
    }
  }
  return { ops: parsed.data }
}
