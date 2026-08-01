const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("meetShell", {
  connect: (url) => ipcRenderer.invoke("connect-to-server", url),
})
