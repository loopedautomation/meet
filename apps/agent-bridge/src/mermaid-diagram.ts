// Expands a `diagram` canvas op — Mermaid flowchart source — into the
// primitive rect/ellipse/arrow ops the canvas pipeline already knows how to
// build, bind and sync. Models are far better at emitting Mermaid topology
// than at guessing pixel coordinates, so a real layout algorithm (dagre)
// does the positioning instead.
//
// Deliberately a subset: flowchart/graph node-and-edge statements, the
// bread and butter of meeting diagrams. Sequence diagrams, subgraph frames,
// class diagrams and styling directives are out of scope — unknown lines
// are skipped rather than fatal, so a chatty model's `classDef` doesn't
// void its whole diagram.

import dagre from "@dagrejs/dagre"
import type { CanvasOp } from "@meet/shared"

type ParsedNode = {
  id: string
  label: string
  shape: "rect" | "ellipse"
}

type ParsedEdge = {
  from: string
  to: string
  label?: string
}

type ParsedDiagram = {
  direction: "TB" | "LR" | "BT" | "RL"
  nodes: Map<string, ParsedNode>
  edges: ParsedEdge[]
}

/** `a[Text]`, `a(Text)`, `a((Text))`, `a([Text])`, `a[(Text)]`, `a{Text}`. */
const NODE_RE =
  /^([A-Za-z0-9_.-]+)\s*(?:(\(\(|\(\[|\[\(|\{\{|\[|\(|\{)\s*"?([^"\]})]*?)"?\s*(?:\)\)|\]\)|\)\]|\}\}|\]|\)|\}))?$/

/** Arrow/link connectors between nodes, label captured where the syntax has one. */
const CONNECTOR_RE =
  /(?:--\s*([^-<>|]+?)\s*-->|-->\s*\|([^|]*)\||---\s*\|([^|]*)\||-\.->|==>|-->|---)/g

function cleanLabel(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim()
}

function nodeShape(bracket: string | undefined): "rect" | "ellipse" {
  return bracket === "(" ||
    bracket === "((" ||
    bracket === "([" ||
    bracket === "[("
    ? "ellipse"
    : "rect"
}

/** Parse a node reference, registering it (or enriching it) as a side effect. */
function takeNode(
  token: string,
  nodes: Map<string, ParsedNode>,
): string | null {
  const match = token.trim().match(NODE_RE)
  if (!match) return null
  const [, id, bracket, rawLabel] = match
  const existing = nodes.get(id)
  const label = rawLabel !== undefined ? cleanLabel(rawLabel) : undefined
  if (!existing) {
    nodes.set(id, {
      id,
      label: label ?? id,
      shape: nodeShape(bracket),
    })
  } else if (label !== undefined) {
    existing.label = label
    if (bracket) existing.shape = nodeShape(bracket)
  }
  return id
}

export function parseMermaidFlowchart(source: string): ParsedDiagram | null {
  // Tolerate a fenced block — models add them out of habit.
  const text = source
    .replace(/^\s*```(?:mermaid)?\s*/i, "")
    .replace(/```\s*$/, "")
  const lines = text
    .split(/[\n;]/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"))
  if (lines.length === 0) return null

  let direction: ParsedDiagram["direction"] = "TB"
  const header = lines[0].match(/^(?:flowchart|graph)\s*(TD|TB|BT|LR|RL)?/i)
  if (!header) return null
  if (header[1]) {
    const dir = header[1].toUpperCase()
    direction = dir === "TD" ? "TB" : (dir as ParsedDiagram["direction"])
  }

  const nodes = new Map<string, ParsedNode>()
  const edges: ParsedEdge[] = []
  for (const line of lines.slice(1)) {
    // Structure and styling directives we don't render — skip, don't fail.
    if (
      /^(subgraph\b|end$|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b)/i.test(
        line,
      )
    ) {
      continue
    }
    // A chain like `a --> b -->|label| c`: node tokens sit between
    // connector matches, each connector optionally carrying the label of
    // the edge it forms with the next node.
    CONNECTOR_RE.lastIndex = 0
    let cursor = 0
    let prev: string | null = null
    let pendingLabel: string | undefined
    let sawConnector = false
    const link = (token: string) => {
      const id = takeNode(token, nodes)
      if (id === null) return
      if (prev !== null) {
        edges.push({ from: prev, to: id, label: pendingLabel })
      }
      prev = id
    }
    let match = CONNECTOR_RE.exec(line)
    while (match) {
      sawConnector = true
      link(line.slice(cursor, match.index).trim())
      const label = (match[1] ?? match[2] ?? match[3])?.trim()
      pendingLabel = label ? cleanLabel(label) : undefined
      cursor = match.index + match[0].length
      match = CONNECTOR_RE.exec(line)
    }
    if (!sawConnector) {
      takeNode(line, nodes)
      continue
    }
    link(line.slice(cursor).trim())
  }

  if (nodes.size === 0) return null
  return { direction, nodes, edges }
}

/** Rough node box sized to its label; dagre spaces boxes, we size them. */
function nodeSize(label: string): { width: number; height: number } {
  const lines = label.split("\n")
  const longest = Math.max(...lines.map((l) => l.length), 1)
  return {
    width: Math.min(Math.max(longest * 11 + 48, 120), 360),
    height: Math.max(lines.length * 28 + 32, 64),
  }
}

/**
 * Expand a diagram op into primitive canvas ops with concrete positions,
 * relative to (0,0); the caller decides where the block lands as a whole.
 * Returns null when the source isn't parseable as a flowchart.
 */
export function expandDiagram(
  diagramId: string,
  mermaid: string,
): CanvasOp[] | null {
  const parsed = parseMermaidFlowchart(mermaid)
  if (!parsed) return null

  const graph = new dagre.graphlib.Graph()
  graph.setGraph({
    rankdir: parsed.direction,
    nodesep: 60,
    ranksep: 80,
    marginx: 0,
    marginy: 0,
  })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const node of parsed.nodes.values()) {
    graph.setNode(node.id, nodeSize(node.label))
  }
  for (const edge of parsed.edges) {
    if (parsed.nodes.has(edge.from) && parsed.nodes.has(edge.to)) {
      graph.setEdge(edge.from, edge.to)
    }
  }
  dagre.layout(graph)

  const ops: CanvasOp[] = []
  // dagre positions node centers; the canvas wants top-left corners, and
  // the whole block normalized to start at (0,0).
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  for (const node of parsed.nodes.values()) {
    const placed = graph.node(node.id)
    minX = Math.min(minX, placed.x - placed.width / 2)
    minY = Math.min(minY, placed.y - placed.height / 2)
  }
  // Edge routing can swing outside the node bounding box (a cycle's back
  // edge bends around the rank row) — include it, so nothing lands at
  // negative coordinates relative to the block's placement spot.
  for (const e of graph.edges()) {
    for (const p of graph.edge(e)?.points ?? []) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
    }
  }
  for (const node of parsed.nodes.values()) {
    const placed = graph.node(node.id)
    ops.push({
      op: node.shape,
      id: `${diagramId}.${node.id}`,
      x: placed.x - placed.width / 2 - minX,
      y: placed.y - placed.height / 2 - minY,
      w: placed.width,
      h: placed.height,
      label: node.label,
    })
  }
  for (const edge of parsed.edges) {
    if (!parsed.nodes.has(edge.from) || !parsed.nodes.has(edge.to)) continue
    // Dagre routes every edge (around ranks for back-edges in a cycle);
    // carry the interior waypoints so a long return arrow bends around the
    // diagram instead of cutting straight through the boxes it passes.
    const layout = graph.edge(edge.from, edge.to) as
      | { points?: { x: number; y: number }[] }
      | undefined
    const via = (layout?.points ?? []).slice(1, -1).map((p) => ({
      x: Math.round(p.x - minX),
      y: Math.round(p.y - minY),
    }))
    ops.push({
      op: "arrow",
      id: `${diagramId}.${edge.from}->${edge.to}`,
      from: `${diagramId}.${edge.from}`,
      to: `${diagramId}.${edge.to}`,
      via: via.length ? via.slice(0, 16) : undefined,
      label: edge.label,
    })
  }
  return ops
}
