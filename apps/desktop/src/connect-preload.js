const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("meetShell", {
  connect: (url) => ipcRenderer.invoke("connect-to-server", url),
  suggestedServer: () => ipcRenderer.invoke("suggested-server"),
  signInWithBrowser: () => ipcRenderer.invoke("sign-in-with-browser"),
  submitAuthCode: (code) => ipcRenderer.invoke("submit-auth-code", code),
})
