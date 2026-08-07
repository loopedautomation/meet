const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("meetDesktop", {
  ready: () => ipcRenderer.send("workspace-ready"),
})
