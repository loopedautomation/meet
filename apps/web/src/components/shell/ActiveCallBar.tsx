"use client"

import { PhoneCall } from "lucide-react"
import { useRouter } from "next/navigation"

/**
 * Shown over the currently-viewed page whenever a channel call is connected
 * but the user has navigated away from it. Leaving is a ControlBar action —
 * this bar only offers a way back, keeping it simple (see plan for #236).
 */
export function ActiveCallBar({ channelSlug }: { channelSlug: string }) {
  const router = useRouter()
  return (
    <div className="-translate-x-1/2 absolute bottom-4 left-1/2 z-10 flex items-center gap-3 rounded-full border border-base-300 bg-base-100 px-4 py-2 shadow-lg">
      <PhoneCall className="size-4 text-success" />
      <span className="text-sm">
        In call: <span className="font-medium">#{channelSlug}</span>
      </span>
      <button
        type="button"
        className="btn btn-primary btn-xs"
        onClick={() => router.push(`/c/${channelSlug}`)}
      >
        Return
      </button>
    </div>
  )
}
