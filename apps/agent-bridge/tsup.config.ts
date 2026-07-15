import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts", "src/worker.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  // Workspace package ships TS source — inline it; everything else stays external.
  noExternal: ["@meet/shared"],
})
