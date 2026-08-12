const { contextBridge, ipcRenderer } = require("electron")

// Presence of window.desktopBridge is itself the "am I in Electron" signal
// the web app's client-side notification dispatch relies on.
contextBridge.exposeInMainWorld("desktopBridge", {
  notifyMessage: (payload) =>
    ipcRenderer.send("show-message-notification", payload),
})
