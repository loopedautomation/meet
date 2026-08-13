"use client"

import ReactMarkdown from "react-markdown"
import remarkEmoji from "remark-emoji"
import remarkGfm from "remark-gfm"

/**
 * Rendered GitHub-flavored markdown, used by the doc preview and chat.
 * react-markdown never emits raw HTML from the source text, so room-supplied
 * content (peers, agents) can't inject markup.
 */
export function Markdown({
  text,
  className = "",
  size = "sm",
}: {
  text: string
  className?: string
  /**
   * Typography-plugin scale, applied as the literal `prose-sm`/`prose-base`
   * modifier (not a trailing `text-*` utility) — layering a `text-*` class
   * on top would set `font-size` from two different sources on the same
   * element, which Tailwind resolves by generated-CSS order rather than
   * class-list order, so it's not something to rely on. Defaults to `"sm"`
   * to keep existing callers (chat bubbles, doc preview) unchanged.
   */
  size?: "sm" | "base"
}) {
  return (
    <div
      className={`prose ${size === "base" ? "prose-base" : "prose-sm"} max-w-none break-words prose-headings:font-medium prose-pre:rounded-box prose-pre:bg-base-200 prose-pre:text-base-content prose-code:before:content-none prose-code:after:content-none ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkEmoji]}
        components={{
          // Open links in a new tab so navigating doesn't tear down the meeting.
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
