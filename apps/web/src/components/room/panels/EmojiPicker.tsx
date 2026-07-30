"use client"

import { useEffect, useRef } from "react"

const EMOJIS = [
  "😀",
  "😄",
  "😂",
  "🙂",
  "😉",
  "😍",
  "🤔",
  "😎",
  "😢",
  "😮",
  "😴",
  "🥳",
  "😅",
  "🙃",
  "😇",
  "🤯",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🙏",
  "👋",
  "✌️",
  "🤝",
  "❤️",
  "🔥",
  "🎉",
  "✅",
  "❌",
  "⭐",
  "💯",
  "🚀",
]

export function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-20 mb-1 grid w-64 grid-cols-8 gap-0.5 rounded-box bg-base-100 p-1 shadow-lg ring-1 ring-base-300"
    >
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="btn btn-ghost btn-xs btn-square text-lg"
          onClick={() => onPick(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}
