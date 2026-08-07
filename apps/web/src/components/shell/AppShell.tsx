"use client"

import { useStore } from "@nanostores/react"
import { RoomClient } from "@/components/room/RoomClient"
import { $activeCall } from "@/stores/activeCall"
import { $channelRoom } from "@/stores/channelContext"
import { ActiveCallBar } from "./ActiveCallBar"
import { AppSidebar, type ServerSummary, type SidebarUser } from "./AppSidebar"
import { MobileSidebarToggle } from "./MobileSidebarToggle"

/**
 * The member app shell: sidebar + main content area. Lives above route
 * changes so a channel call — mounted here via RoomClient, not by the
 * channel page — survives navigating to a different channel. See the
 * plan for #236: when the connected call's room differs from the room
 * currently being viewed (JoinChannelCall sets $channelRoom per page), the
 * call UI is CSS-hidden rather than unmounted, keeping audio/connection
 * alive, and ActiveCallBar offers a way back.
 */
export function AppShell({
  user,
  serverName,
  servers,
  activeServerId,
  children,
}: {
  user: SidebarUser
  serverName: string
  /** Every server this member belongs to — the switcher rail's data. */
  servers: ServerSummary[]
  activeServerId: string | null
  children: React.ReactNode
}) {
  const activeCall = useStore($activeCall)
  const viewedRoom = useStore($channelRoom)
  const viewingCall = activeCall?.room === viewedRoom

  return (
    <>
      <MobileSidebarToggle />
      <div className="flex min-h-0 flex-1">
        <AppSidebar
          // Remount on server switch — AppSidebar owns client-side state
          // (loaded channels, the presence SSE connection) that a prop
          // change alone wouldn't reset, so without this key it keeps
          // showing the previous server's channels after switching.
          key={activeServerId}
          user={user}
          serverName={serverName}
          servers={servers}
          activeServerId={activeServerId}
        />
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <div className={activeCall && !viewingCall ? "hidden" : "contents"}>
            {children}
          </div>
          {activeCall && (
            <div className={viewingCall ? "absolute inset-0" : "hidden"}>
              <RoomClient
                key={activeCall.room}
                slug={activeCall.room}
                mode="channel"
              />
            </div>
          )}
          {activeCall && !viewingCall && (
            <ActiveCallBar channelSlug={activeCall.channelSlug} />
          )}
        </main>
      </div>
    </>
  )
}
