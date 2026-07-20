"use client"

import { useParticipants } from "@livekit/components-react"
import { parseParticipantMeta } from "@meet/shared"
import { Bot, User } from "lucide-react"

export type Mentionable = {
  name: string
  isAgent: boolean
}

/** Everyone in the call who can be @-mentioned (excludes yourself). */
export function useMentionables(): Mentionable[] {
  const participants = useParticipants()
  return participants
    .filter((p) => !p.isLocal && (p.name || p.identity))
    .filter((p) => {
      const kind = parseParticipantMeta(p.metadata)?.kind
      return kind !== "service" && kind !== "waiting"
    })
    .map((p) => ({
      name: p.name || p.identity,
      isAgent: parseParticipantMeta(p.metadata)?.kind === "agent",
    }))
}

/** The active "@query" at the end of the draft, or null. */
export function mentionQuery(draft: string): string | null {
  const match = draft.match(/(?:^|\s)@([\w-]*)$/)
  return match ? match[1] : null
}

export function completeMention(draft: string, name: string): string {
  return draft.replace(/@[\w-]*$/, `@${name} `)
}

/** The visible (capped) match list — shared with the input's key handler so
 * arrow/enter navigation and the rendered rows never disagree. */
export function matchMentions(
  candidates: Mentionable[],
  query: string,
): Mentionable[] {
  return candidates
    .filter((c) => c.name.toLowerCase().startsWith(query.toLowerCase()))
    .slice(0, 6)
}

export function MentionPicker({
  matches,
  active,
  onPick,
  onHover,
}: {
  matches: Mentionable[]
  active: number
  onPick: (name: string) => void
  onHover: (index: number) => void
}) {
  if (matches.length === 0) return null

  return (
    <ul className="absolute bottom-full left-0 z-20 mb-1 w-56 rounded-box bg-base-100 p-1 shadow-lg ring-1 ring-base-300">
      {matches.map((c, i) => (
        <li key={c.name}>
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-sm ${
              i === active ? "bg-base-200" : ""
            }`}
            onClick={() => onPick(c.name)}
            onMouseEnter={() => onHover(i)}
          >
            {c.isAgent ? (
              <Bot className="size-4 text-primary" />
            ) : (
              <User className="size-4 text-base-content/60" />
            )}
            {c.name}
          </button>
        </li>
      ))}
    </ul>
  )
}
