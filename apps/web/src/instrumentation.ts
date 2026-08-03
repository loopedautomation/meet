// Runs once at server boot (dev and standalone alike), before traffic is
// served. Migrations live here rather than in a separate CMD step so the
// migrator and its dependencies ride Next's file tracing into the standalone
// image, and a bad migration fails the boot loudly instead of being served
// around. NEXT_RUNTIME is inlined at build time, so the node-only module is
// dead-code-eliminated from the edge bundle.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node")
    await registerNode()
  }
}
