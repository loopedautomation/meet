"use client"

import { Menu } from "lucide-react"
import { $mobileSidebarOpen } from "@/stores/mobileSidebar"

/** Opens the AppSidebar drawer below md, where it's otherwise unreachable
 * (the sidebar itself is `fixed` and off-screen there — see AppSidebar). */
export function MobileSidebarToggle() {
  return (
    <button
      type="button"
      className="btn btn-circle btn-ghost fixed top-3 left-3 z-30 bg-base-100/80 backdrop-blur md:hidden"
      aria-label="Open sidebar"
      title="Open sidebar"
      onClick={() => $mobileSidebarOpen.set(true)}
    >
      <Menu className="size-5" />
    </button>
  )
}
