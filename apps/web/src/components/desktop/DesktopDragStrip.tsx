import { headers } from "next/headers"

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
  const inElectron = ((await headers()).get("user-agent") ?? "").includes(
    "Electron",
  )
  if (!inElectron) return null
  return (
    <div
      className="h-9 shrink-0 border-base-300 border-b bg-base-200/60"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    />
  )
}
