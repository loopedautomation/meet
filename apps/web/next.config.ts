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
