/**
 * Bundled virtual backgrounds, generated as canvas gradients at runtime so
 * they ship zero image assets and always match the display's aspect. Data
 * URLs are memoized — the segmenter reloads the image per call otherwise.
 */

export type CameraEffect = "none" | "blur" | (typeof BACKGROUNDS)[number]["id"]

export const BACKGROUNDS = [
  { id: "dusk", label: "Dusk", stops: ["#312e81", "#831843"] },
  { id: "forest", label: "Forest", stops: ["#14532d", "#0f172a"] },
  { id: "slate", label: "Slate", stops: ["#334155", "#0f172a"] },
] as const

const cache = new Map<string, string>()

export function backgroundImageUrl(id: string): string | undefined {
  const bg = BACKGROUNDS.find((b) => b.id === id)
  if (!bg) return undefined
  const cached = cache.get(id)
  if (cached) return cached
  const canvas = document.createElement("canvas")
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext("2d")
  if (!ctx) return undefined
  const gradient = ctx.createLinearGradient(0, 0, 1280, 720)
  gradient.addColorStop(0, bg.stops[0])
  gradient.addColorStop(1, bg.stops[1])
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 1280, 720)
  // Soft vignette so faces read against a non-flat backdrop.
  const vignette = ctx.createRadialGradient(640, 360, 250, 640, 360, 800)
  vignette.addColorStop(0, "rgba(0,0,0,0)")
  vignette.addColorStop(1, "rgba(0,0,0,0.35)")
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, 1280, 720)
  const url = canvas.toDataURL("image/jpeg", 0.85)
  cache.set(id, url)
  return url
}
