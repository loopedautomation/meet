import type {NextConfig} from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@meet/shared"],
}

export default nextConfig
