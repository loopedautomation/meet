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
}: {
  text: string
  className?: string
}) {
  return (
    <div
      className={`prose prose-sm max-w-none break-words prose-headings:font-medium prose-pre:rounded-box prose-pre:bg-base-200 prose-pre:text-base-content prose-code:before:content-none prose-code:after:content-none ${className}`}
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
