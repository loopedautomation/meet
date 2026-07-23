"use client"

import { useDataChannel, useLocalParticipant } from "@livekit/components-react"
import {
  type ChatMessage,
  type ChatOp,
  DataTopic,
  TYPING_HEARTBEAT_MS,
} from "@meet/shared"
import { useStore } from "@nanostores/react"
import { Pencil, SendHorizontal, Trash2 } from "lucide-react"
import { nanoid } from "nanoid"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  completeMention,
  MentionPicker,
  matchMentions,
  mentionQuery,
  useMentionables,
} from "@/components/room/panels/MentionPicker"
import {
  $chatMessages,
  $typingAgents,
  addChatMessage,
  removeChatMessage,
  updateChatMessage,
} from "@/stores/roomData"

/**
 * Render message text with URLs as real links. `break-all` on the anchor so
 * long URLs wrap inside the bubble instead of overflowing it.
 */
function linkify(text: string): React.ReactNode[] {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="link break-all"
      >
        {part}
      </a>
    ) : (
      part
    ),
  )
}

/** "Ada is typing…", "Ada and Ben are typing…", "3 people are typing…". */
function typingLabel(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`
  return `${names.length} people are typing`
}

function ChatMessageRow({
  message,
  own,
  grouped,
  lastInGroup,
  isEditing,
  editText,
  onEditTextChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  confirmingDelete,
  onConfirmDelete,
  onDelete,
  onCancelDeleteConfirm,
}: {
  message: ChatMessage
  own: boolean
  grouped: boolean
  lastInGroup: boolean
  isEditing: boolean
  editText: string
  onEditTextChange: (text: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  confirmingDelete: boolean
  onConfirmDelete: () => void
  onDelete: () => void
  onCancelDeleteConfirm: () => void
}) {
  return (
    <li
      className={`group chat ${own ? "chat-end" : "chat-start"} ${grouped ? "mt-1 !pt-0" : "not-first:mt-2"} ${lastInGroup ? "" : "!pb-0"}`}
    >
      {!grouped && (
        <div className="chat-header text-base-content/50 text-xs">
          {!own && (
            <span className="mr-1 font-medium text-base-content">
              {message.fromName}
            </span>
          )}
          <time>
            {new Date(message.at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
      )}
      {isEditing ? (
        <div className="chat-bubble min-w-0 max-w-[85%] bg-transparent p-0">
          <input
            autoFocus
            className="input input-sm w-full"
            value={editText}
            onChange={(e) => onEditTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                onSaveEdit()
              } else if (e.key === "Escape") {
                e.preventDefault()
                onCancelEdit()
              }
            }}
            onBlur={onSaveEdit}
          />
        </div>
      ) : (
        <div
          className={`chat-bubble relative min-h-0 min-w-0 max-w-[85%] rounded-lg px-2.5 py-1 whitespace-pre-wrap break-words text-sm ${
            own ? "chat-bubble-primary" : ""
          } ${
            lastInGroup
              ? own
                ? "rounded-br-none"
                : "rounded-bl-none"
              : "before:hidden"
          }`}
        >
          {linkify(message.text)}
          {own && (
            <MessageActions
              onStartEdit={onStartEdit}
              confirmingDelete={confirmingDelete}
              onConfirmDelete={onConfirmDelete}
              onDelete={onDelete}
              onCancelDeleteConfirm={onCancelDeleteConfirm}
            />
          )}
        </div>
      )}
      {own && !isEditing && message.editedAt && (
        <div className="chat-footer text-base-content/40 text-xs">edited</div>
      )}
    </li>
  )
}

function MessageActions({
  onStartEdit,
  confirmingDelete,
  onConfirmDelete,
  onDelete,
  onCancelDeleteConfirm,
}: {
  onStartEdit: () => void
  confirmingDelete: boolean
  onConfirmDelete: () => void
  onDelete: () => void
  onCancelDeleteConfirm: () => void
}) {
  return (
    <div className="pointer-events-none absolute top-1/2 right-full flex -translate-y-1/2 items-center gap-1 pr-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 has-[:focus]:pointer-events-auto has-[:focus]:opacity-100">
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-circle"
        aria-label="Edit message"
        title="Edit"
        onClick={onStartEdit}
      >
        <Pencil className="size-3" />
      </button>
      {confirmingDelete ? (
        <button
          type="button"
          className="btn btn-error btn-xs"
          onClick={onDelete}
          onBlur={onCancelDeleteConfirm}
        >
          Delete?
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle text-error"
          aria-label="Delete message"
          title="Delete"
          onClick={onConfirmDelete}
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  )
}

export function ChatPanel() {
  const { localParticipant } = useLocalParticipant()
  const messages = useStore($chatMessages)
  const typing = useStore($typingAgents)
  const typingNames = Object.values(typing).map((t) => t.name)
  const [draft, setDraft] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState("")
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  )
  const bottomRef = useRef<HTMLDivElement>(null)
  const mentionables = useMentionables()
  const query = mentionQuery(draft)
  const matches = query !== null ? matchMentions(mentionables, query) : []
  // Keyboard navigation through the mention picker; reset as the query moves.
  const [active, setActive] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: query drives the reset
  useEffect(() => setActive(0), [query])

  const pickerKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (query === null || matches.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => (i + 1) % matches.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => (i - 1 + matches.length) % matches.length)
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      setDraft((d) => completeMention(d, matches[active].name))
    }
  }

  const { send } = useDataChannel(DataTopic.Chat)
  const { send: sendActivity } = useDataChannel(DataTopic.AgentActivity)

  // Human typing presence, on the same topic and event agents use (the
  // listener attributes by verified sender, so agentId carries no weight).
  // Heartbeat while composing; peers prune stale indicators themselves, so
  // a dropped "stopped" signal can't stick.
  const typingSentAt = useRef(0)
  const sendTyping = useCallback(
    (typing: boolean) => {
      typingSentAt.current = typing ? Date.now() : 0
      void sendActivity(
        new TextEncoder().encode(
          JSON.stringify({
            type: "typing",
            agentId: "",
            typing,
            at: Date.now(),
          }),
        ),
        { topic: DataTopic.AgentActivity, reliable: false },
      )
    },
    [sendActivity],
  )
  const draftChanged = (value: string) => {
    setDraft(value)
    if (!value.trim()) {
      if (typingSentAt.current) sendTyping(false)
    } else if (Date.now() - typingSentAt.current > TYPING_HEARTBEAT_MS) {
      sendTyping(true)
    }
  }

  // Follow the conversation: jump on open, glide on each new message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages drives the scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    const message: ChatMessage = {
      id: nanoid(8),
      from: localParticipant.identity,
      fromName: localParticipant.name || localParticipant.identity,
      text,
      at: Date.now(),
    }
    setDraft("")
    if (typingSentAt.current) sendTyping(false)
    addChatMessage(message)
    await send(new TextEncoder().encode(JSON.stringify(message)), {
      topic: DataTopic.Chat,
      reliable: true,
    })
  }

  const startEdit = (m: ChatMessage) => {
    setConfirmingDeleteId(null)
    setEditingId(m.id)
    setEditText(m.text)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText("")
  }

  const saveEdit = async (id: string) => {
    const text = editText.trim()
    setEditingId(null)
    setEditText("")
    if (!text) return
    const at = Date.now()
    updateChatMessage(id, localParticipant.identity, text, at)
    const op: ChatOp = { op: "edit", id, text, at }
    await send(new TextEncoder().encode(JSON.stringify(op)), {
      topic: DataTopic.Chat,
      reliable: true,
    })
  }

  const deleteMessage = async (id: string) => {
    setConfirmingDeleteId(null)
    const op: ChatOp = { op: "delete", id, at: Date.now() }
    removeChatMessage(id, localParticipant.identity)
    await send(new TextEncoder().encode(JSON.stringify(op)), {
      topic: DataTopic.Chat,
      reliable: true,
    })
  }

  return (
    <div className="flex h-full flex-col">
      <ul className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <li className="text-base-content/50 text-sm">
            No messages yet. Mention an agent with @Name to ask it in text.
          </li>
        )}
        {messages.map((m, i) => {
          const own = m.from === localParticipant.identity
          // Consecutive messages from the same sender within the same
          // displayed minute share one header — order stays untouched, only
          // the repeated name/stamp is dropped.
          const prev = messages[i - 1]
          const minute = (at: number) => Math.floor(at / 60_000)
          const grouped = Boolean(
            prev && prev.from === m.from && minute(prev.at) === minute(m.at),
          )
          const next = messages[i + 1]
          const lastInGroup = !(
            next &&
            next.from === m.from &&
            minute(next.at) === minute(m.at)
          )
          return (
            <ChatMessageRow
              key={m.id}
              message={m}
              own={own}
              grouped={grouped}
              lastInGroup={lastInGroup}
              isEditing={editingId === m.id}
              editText={editText}
              onEditTextChange={setEditText}
              onStartEdit={() => startEdit(m)}
              onCancelEdit={cancelEdit}
              onSaveEdit={() => saveEdit(m.id)}
              confirmingDelete={confirmingDeleteId === m.id}
              onConfirmDelete={() => setConfirmingDeleteId(m.id)}
              onDelete={() => deleteMessage(m.id)}
              onCancelDeleteConfirm={() => setConfirmingDeleteId(null)}
            />
          )
        })}
        <div ref={bottomRef} />
      </ul>
      {typingNames.length > 0 && (
        <div
          aria-live="polite"
          className="flex items-center gap-2 px-4 pb-1 text-base-content/50 text-xs"
        >
          <span className="flex items-center gap-0.5" aria-hidden="true">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </span>
          <span>{typingLabel(typingNames)}…</span>
        </div>
      )}
      <form onSubmit={handleSend} className="relative flex gap-2 p-3">
        {query !== null && (
          <MentionPicker
            matches={matches}
            active={active}
            onPick={(name) => setDraft((d) => completeMention(d, name))}
            onHover={setActive}
          />
        )}
        <input
          className="input input-sm flex-1"
          placeholder="Send a message — @ to mention"
          value={draft}
          onChange={(e) => draftChanged(e.target.value)}
          onKeyDown={pickerKeys}
          onBlur={() => {
            if (typingSentAt.current) sendTyping(false)
          }}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm btn-circle"
          disabled={!draft.trim()}
          aria-label="Send message"
        >
          <SendHorizontal className="size-4" />
        </button>
      </form>
    </div>
  )
}
