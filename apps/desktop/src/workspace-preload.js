const { contextBridge, ipcRenderer } = require("electron")

// Exposed to the web app running inside the shell's main window.
// The renderer never sees fs paths or command strings — only opaque repoIds.
//
// Sandbox rules apply here (Electron sandboxes preloads by default when
// nodeIntegration is off): only Electron built-ins may be required. A
// filesystem require — even of package.json — throws, kills the whole
// preload, and the web app silently falls back to "plain browser" mode.
// Anything main-process-flavored (the app version) comes over IPC instead.
const info = ipcRenderer.sendSync("shell:info")

contextBridge.exposeInMainWorld("meetShell", {
  info: {
    version: info?.version ?? "unknown",
    platform: info?.platform ?? "unknown",
    capabilities: ["local-agent"],
  },
  agent: {
    pickRepo: () => ipcRenderer.invoke("agent:pickRepo"),
    recentRepos: () => ipcRenderer.invoke("agent:recentRepos"),
    start: (opts) => ipcRenderer.invoke("agent:start", opts),
    stop: (opts) => ipcRenderer.invoke("agent:stop", opts),
    status: () => ipcRenderer.invoke("agent:status"),
    onStatus: (cb) => {
      const handler = (_e, status) => cb(status)
      ipcRenderer.on("agent:status", handler)
      return () => ipcRenderer.removeListener("agent:status", handler)
    },
  },
})
