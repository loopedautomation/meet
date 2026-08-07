import { Bot } from "lucide-react"

/** Effective presence dot: offline beats everything, then the member's
 * chosen indicator (away/dnd) tints the online dot. */
export function presenceDotClass(m: {
  online: boolean
  presence?: string | null
}): string {
  if (!m.online) return "bg-base-content/20"
  if (m.presence === "away") return "bg-warning"
  if (m.presence === "dnd") return "bg-error"
  return "bg-success"
}

const SIZE_CLASS = {
  xs: "size-5",
  sm: "size-6",
  md: "size-9",
} as const

const DOT_SIZE_CLASS = {
  xs: "size-2",
  sm: "size-2.5",
  md: "size-3",
} as const

const ICON_SIZE_CLASS = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-5",
} as const

export type AvatarSize = keyof typeof SIZE_CLASS

/**
 * A person's (or agent's) face: image, falling back to an initial circle,
 * with an optional presence dot overlay. `online`/`presence` are omitted
 * entirely to skip the dot (e.g. in a stacked group cluster where
 * individual presence doesn't fit); agents never get a dot.
 */
export function Avatar({
  name,
  image,
  size = "md",
  online,
  presence,
  isAgent,
}: {
  name: string
  image?: string | null
  size?: AvatarSize
  online?: boolean
  presence?: string | null
  isAgent?: boolean
}) {
  const sizeClass = SIZE_CLASS[size]
  return (
    <span className="relative inline-flex shrink-0">
      {isAgent ? (
        <span
          className={`flex items-center justify-center rounded-full bg-base-300 ${sizeClass}`}
        >
          <Bot className={ICON_SIZE_CLASS[size]} />
        </span>
      ) : image ? (
        <img
          src={image}
          alt=""
          className={`rounded-full object-cover ${sizeClass}`}
        />
      ) : (
        <span
          className={`flex items-center justify-center rounded-full bg-base-300 font-medium ${sizeClass}`}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      {!isAgent && online !== undefined && (
        <span
          className={`absolute right-0 bottom-0 rounded-full border-2 border-base-200 ${DOT_SIZE_CLASS[size]} ${presenceDotClass({ online, presence })}`}
        />
      )}
    </span>
  )
}
