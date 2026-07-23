import type {NextConfig} from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@meet/shared"],
  async headers() {
    return [
      {
        // The sherpa-onnx WASM bundle is a pthread build: it needs
        // SharedArrayBuffer, which browsers only expose to cross-origin
        // isolated pages. require-corp (not credentialless) keeps Safari.
        // The app is self-contained, and WebRTC/websockets are unaffected.
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          // Baseline hardening. No CSP yet: Next's inline runtime scripts
          // need nonces/hashes and breakage there is silent — tracked as a
          // follow-up rather than shipped half-strict.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // A no-op over plain http; pins https once served over it.
            key: "Strict-Transport-Security",
            value: "max-age=15552000; includeSubDomains",
          },
        ],
      },
      {
        // WASM + STT model assets are large and content-stable; let the
        // browser cache them across visits so the download is a one-time cost.
        source: "/stt/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ]
  },
}

export default nextConfig
