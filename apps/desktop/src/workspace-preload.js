const { contextBridge, ipcRenderer } = require("electron")

// Exposed to the web app running inside the shell's main window.
// The renderer never sees fs paths or command strings — only opaque repoIds.
contextBridge.exposeInMainWorld("meetShell", {
  info: {
    version: require("../../package.json").version,
    platform: process.platform,
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
