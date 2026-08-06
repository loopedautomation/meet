"use client"

import { Menu } from "lucide-react"
import { $mobileSidebarOpen } from "@/stores/mobileSidebar"

/**
 * Opens the AppSidebar drawer below md, where it's otherwise unreachable
 * (the sidebar itself is `fixed` and off-screen there — see AppSidebar).
 * A reserved-height bar, not a floating overlay: every page under (app)
 * has its own header content starting flush with the viewport edge, so a
 * `fixed` button would sit on top of it instead of beside it.
 */
export function MobileSidebarToggle() {
  return (
    <div className="flex h-12 shrink-0 items-center border-base-300 border-b px-2 md:hidden">
      <button
        type="button"
        className="btn btn-circle btn-ghost btn-sm"
        aria-label="Open sidebar"
        title="Open sidebar"
        onClick={() => $mobileSidebarOpen.set(true)}
      >
        <Menu className="size-5" />
      </button>
    </div>
  )
}
