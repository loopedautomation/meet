const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("loopedMeetDesktop", {
  signOut: () => ipcRenderer.invoke("desktop-sign-out"),
})
