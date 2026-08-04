import type { MetadataRoute } from "next"

// The PWA base: installable on mobile, standalone display — the Phase 3
// mobile pass builds on this (a native wrapper only if the PWA isn't
// enough, same instance-served-UI pattern as desktop).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "looped meet",
    short_name: "meet",
    description:
      "The communication home for your team — voice channels, chat, and AI teammates.",
    start_url: "/",
    display: "standalone",
    background_color: "#111111",
    theme_color: "#111111",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
  }
}
