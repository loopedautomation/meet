import type {NextConfig} from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@meet/shared"],
  async headers() {
    return [
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
