// looped meet desktop: a thin shell over an instance's member UI. The app
// owns nothing but the window — the UI is served by whichever server you
// connect to (self-hosted or hosted), so it works with any instance and
// updates ship server-side. What the shell adds is the native layer: tray
// presence ("who's in #standup" from the menu bar), a global shortcut,
// notifications, auto-launch.
const fs = require("node:fs")
const path = require("node:path")
const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  session,
  shell,
  Tray,
} = require("electron")

const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json")

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"))
  } catch {
    return {}
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch }
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true })
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(next, null, 2))
  return next
}

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {Tray | null} */
let tray = null
let presenceTimer = null
// Last seen occupancy per channel slug — notification edge detection.
const lastOccupancy = new Map()

function serverUrl() {
  return loadSettings().serverUrl ?? null
}

// 16x16 monochrome dot — a placeholder template icon until brand art lands.
const TRAY_ICON = nativeImage.createFromDataURL(
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAcElEQVR4nKWTwQ3AIAwDL1U3yJhs1jHTR6WCQoWa4Bd62TgWmNkFYGYXtRoAVb2f8xNJPCFXm3AEwMx2YFmA1t3rIN45CKMYm4gzmJcirD5AJZFEHRJTBBRoS8T2H4hOsWXQfSjRJdpv7B/pE2Y/0w3IlUbBB6NC1QAAAABJRU5ErkJggg==",
)

function createConnectWindow() {
  const win = new BrowserWindow({
    width: 460,
    height: 320,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "connect-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(path.join(__dirname, "connect.html"))
  return win
}

function createMainWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadURL(url)
  // Links that leave the instance open in the default browser, not in the
  // shell — the shell is for your server only.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) {
      void shell.openExternal(target)
      return { action: "deny" }
    }
    return { action: "allow" }
  })
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

function showWorkspace(pathname = "/") {
  const base = serverUrl()
  if (!base) return
  if (!mainWindow) {
    mainWindow = createMainWindow(new URL(pathname, base).toString())
  } else {
    if (pathname !== "/") {
      void mainWindow.loadURL(new URL(pathname, base).toString())
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

/** The instance's channel list, using the shell session's cookies (the
 * member signed in inside the window; the tray reuses that session). */
async function fetchChannels() {
  const base = serverUrl()
  if (!base) return null
  try {
    const res = await session.defaultSession.fetch(new URL("/api/channels", base).toString(), {
      credentials: "include",
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.channels ?? null
  } catch {
    return null
  }
}

function rebuildTray(channels) {
  if (!tray) return
  const channelItems =
    channels === null
      ? [{ label: "Sign in in the app to see channels", enabled: false }]
      : channels.length === 0
        ? [{ label: "No channels yet", enabled: false }]
        : channels.map((c) => ({
            label:
              c.occupants > 0
                ? `#${c.slug} — ${c.occupantList
                    .map((o) => o.name ?? "someone")
                    .slice(0, 4)
                    .join(", ")}`
                : `#${c.slug}`,
            click: () => showWorkspace(`/c/${c.slug}`),
          }))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open looped meet", click: () => showWorkspace() },
      { type: "separator" },
      ...channelItems,
      { type: "separator" },
      {
        label: "Launch at login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      {
        label: "Change server…",
        click: () => {
          saveSettings({ serverUrl: null })
          mainWindow?.close()
          createConnectWindow()
        },
      },
      { type: "separator" },
      { label: "Quit", role: "quit" },
    ]),
  )
}

function notifyJoins(channels) {
  if (!channels) return
  for (const c of channels) {
    const before = lastOccupancy.get(c.slug) ?? 0
    // Only announce a channel coming alive, and only while the app is in
    // the background — presence you can already see needs no toast.
    if (before === 0 && c.occupants > 0 && !mainWindow?.isFocused()) {
      const who = c.occupantList.map((o) => o.name ?? "someone").join(", ")
      new Notification({
        title: `#${c.slug} is live`,
        body: `${who} joined — click to hop in`,
        silent: true,
      })
        .on("click", () => showWorkspace(`/c/${c.slug}`))
        .show()
    }
    lastOccupancy.set(c.slug, c.occupants)
  }
}

async function pollPresence() {
  const channels = await fetchChannels()
  rebuildTray(channels)
  notifyJoins(channels)
}

app.whenReady().then(() => {
  // The member UI needs camera/mic (and screenshare via the handler below);
  // grant media to the configured server only.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const base = serverUrl()
    const fromServer = base && wc.getURL().startsWith(base)
    cb(Boolean(fromServer) && ["media", "notifications", "display-capture"].includes(permission))
  })
  // getDisplayMedia: v1 shares the primary screen; a source picker can come
  // with polish.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer
      .getSources({ types: ["screen"] })
      .then((sources) => cb({ video: sources[0] }))
      .catch(() => cb({}))
  })

  ipcMain.handle("connect-to-server", async (_e, rawUrl) => {
    let base
    try {
      base = new URL(rawUrl).origin
    } catch {
      return { ok: false, error: "That doesn't look like a URL." }
    }
    try {
      const res = await fetch(new URL("/api/health", base), {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      return { ok: false, error: "Couldn't reach a meet server at that address." }
    }
    saveSettings({ serverUrl: base })
    BrowserWindow.getAllWindows().forEach((w) => w.close())
    showWorkspace()
    return { ok: true }
  })

  tray = new Tray(TRAY_ICON)
  tray.setToolTip("looped meet")
  rebuildTray(null)
  presenceTimer = setInterval(() => void pollPresence(), 15_000)
  void pollPresence()

  // One keystroke from anywhere back to the workspace.
  globalShortcut.register("CommandOrControl+Shift+M", () => showWorkspace())

  if (serverUrl()) showWorkspace()
  else createConnectWindow()

  app.on("activate", () => {
    if (serverUrl()) showWorkspace()
  })
})

// Tray app: closing the window keeps the shell (and its presence polling)
// alive; Quit lives in the tray menu.
app.on("window-all-closed", (e) => {
  e?.preventDefault?.()
})

app.on("will-quit", () => {
  globalShortcut.unregisterAll()
  if (presenceTimer) clearInterval(presenceTimer)
})
