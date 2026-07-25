import { atom } from "nanostores"

/**
 * Document Picture-in-Picture: a small always-on-top browser window that
 * shows the other participants while you're screen sharing on a single
 * display (Chrome/Edge only — Safari and Firefox don't ship the API yet).
 * The window itself lives here; PipParticipants portals tiles into it.
 */

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: {
        width?: number
        height?: number
      }): Promise<Window>
    }
  }
}

export const $pipWindow = atom<Window | null>(null)

/**
 * Must be called directly from a click handler — requestWindow requires a
 * user gesture and rejects without one.
 */
export async function openPip(): Promise<void> {
  const api = window.documentPictureInPicture
  if (!api) return
  const pip = await api.requestWindow({ width: 320, height: 540 })

  // The PiP document starts blank: it inherits neither stylesheets nor the
  // daisyUI theme attributes on <html>, so copy both across before any
  // tiles are portaled in.
  for (const attr of Array.from(document.documentElement.attributes)) {
    pip.document.documentElement.setAttribute(attr.name, attr.value)
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n")
      const style = pip.document.createElement("style")
      style.textContent = css
      pip.document.head.appendChild(style)
    } catch {
      // Cross-origin sheets block cssRules access — link them instead.
      if (sheet.href) {
        const link = pip.document.createElement("link")
        link.rel = "stylesheet"
        link.href = sheet.href
        pip.document.head.appendChild(link)
      }
    }
  }

  pip.addEventListener("pagehide", () => {
    if ($pipWindow.get() === pip) $pipWindow.set(null)
  })
  $pipWindow.set(pip)
}

export function closePip() {
  $pipWindow.get()?.close()
  $pipWindow.set(null)
}
