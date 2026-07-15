export function BrandMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle
        cx="16"
        cy="16"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        className="text-primary"
      />
      <circle cx="26" cy="8" r="4" className="fill-secondary" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 font-semibold text-lg tracking-tight">
      <BrandMark />
      <span>
        looped <span className="text-primary">meet</span>
      </span>
    </span>
  )
}
