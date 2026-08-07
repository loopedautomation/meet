import { isElectronRequest } from "@/lib/server/desktop"

/**
 * Draggable strip for the desktop shell, which hides the window chrome
 * (titleBarStyle: hiddenInset) and so has nothing to drag the window by. The
 * height clears the traffic lights.
 *
 * Rendered by every layout the shell can land on, not just the signed-in app
 * — a window you can't move is worst exactly where people arrive first, on
 * the signed-out page.
 *
 * Returns null in a browser, where the OS already provides a title bar.
 */
export async function DesktopDragStrip() {
  if (!(await isElectronRequest())) return null
  return (
    <div
      className="h-9 shrink-0 border-base-300 border-b bg-base-200/60"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    />
  )
}
