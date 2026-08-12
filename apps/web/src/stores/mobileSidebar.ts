import { atom } from "nanostores"

/** Whether the mobile drawer copy of AppSidebar is slid into view. Unused
 * at md+, where the sidebar is always visible in normal flow. */
export const $mobileSidebarOpen = atom(false)
