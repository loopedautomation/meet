import { headers } from "next/headers"

/** Whether this request came from the desktop shell — trusted only because
 * the shell is a plain BrowserWindow with no way for page content to spoof
 * its own request's User-Agent. */
export async function isElectronRequest(): Promise<boolean> {
  return ((await headers()).get("user-agent") ?? "").includes("Electron")
}
