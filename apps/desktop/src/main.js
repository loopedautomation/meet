// looped meet desktop: a thin shell over an instance's member UI. The app
// owns nothing but the window — the UI is served by whichever server you
// connect to (self-hosted or hosted), so it works with any instance and
// updates ship server-side. What the shell adds is the native layer: channel
// presence in the app menu ("who's in #standup"), a global shortcut,
// notifications, auto-launch.
const crypto = require("node:crypto")
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
} = require("electron")
const { autoUpdater } = require("electron-updater")

// Brand icon; electron-builder derives the packaged icns/ico from the same
// file, this path covers dev runs and Linux/Windows windows.
const APP_ICON = path.join(__dirname, "..", "build", "icon.png")

// Dev runs get their own userData directory, mirroring looped whisper's
// "(Dev)" split. Without this a `pnpm dev` session and an installed release
// share one settings file, and a dev server URL leaks into the packaged app
// — which presents as a blank window pointed at a localhost that isn't
// running. Must happen before anything reads app.getPath("userData").
if (!app.isPackaged) app.setName(`${app.getName()} (Dev)`)

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
let presenceTimer = null
let updateTimer = null
// Set once an update is downloaded and staged — the tray reads this to offer
// the restart, and the app installs it on quit either way.
let updateReady = null
// Most recent channel list handed to the tray, so it can be rebuilt without
// waiting for the next presence poll.
let lastChannels = null
// Last seen occupancy per channel slug — notification edge detection.
const lastOccupancy = new Map()

// The instance most users want, offered as the prefilled suggestion on the
// connect screen rather than connected to silently — self-hosting stays
// visible, and picking it is one click.
// TODO: flip to https://meet.looped.sh once the hosted instance is live.
const DEFAULT_SERVER_URL = "https://meet.dev.looped.sh"

/** MEET_SERVER_URL selects the server outright, so dev runs (and scripted or
 * kiosk deployments) skip the connect screen. It's still only a default:
 * once a server has been chosen in the app the saved value wins, and
 * "Change server…" writes an explicit null the env var must not resurrect. */
function envServerUrl() {
  const raw = process.env.MEET_SERVER_URL
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    console.warn(`MEET_SERVER_URL is not a valid URL, ignoring: ${raw}`)
    return null
  }
}

function serverUrl() {
  const saved = loadSettings().serverUrl
  return saved !== undefined ? saved : envServerUrl()
}

/** What the connect screen prefills: the server currently in use if there is
 * one (so "Change server…" opens on the existing address), else the default. */
function suggestedServerUrl() {
  return serverUrl() ?? DEFAULT_SERVER_URL
}

// ---- Compatibility handshake ----------------------------------------------
// Mirrors packages/shared/src/protocol.ts, which documents the contract and
// when to bump — that file is the source of truth. Duplicated rather than
// imported because this is a plain CommonJS Electron process with no build
// step, and the alternative (bundling the TS package into the shell) buys
// nothing for two integers. protocol.test.ts asserts the shared side; the
// values below must be updated alongside it.
const CLIENT_PROTOCOL = 1
/** Oldest server protocol this shell can talk to. */
const MIN_SERVER_PROTOCOL = 1
const SERVICE_ID = "looped-meet"

/** How long the loading splash waits for the workspace to report itself
 * ready (see workspace-preload.js) before showing the window regardless.
 * The backstop for servers that predate the ready signal, or routes (the
 * signed-out shell) that never send it — the window must never hang. */
const STARTUP_READY_TIMEOUT_MS = 6000

/**
 * Probe a server and check we can actually talk to it. Every failure mode
 * returns a message naming the side at fault and the action that fixes it —
 * "couldn't reach it" and "reached it but it's four versions ahead" are very
 * different problems for the person typing the address.
 */
async function handshake(base) {
  let body
  try {
    const res = await fetch(new URL("/api/health", base), {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(String(res.status))
    body = await res.json()
  } catch {
    return { ok: false, error: "Couldn't reach a meet server at that address." }
  }

  if (
    !body ||
    typeof body !== "object" ||
    body.service !== SERVICE_ID ||
    typeof body.protocol !== "number" ||
    typeof body.minClientProtocol !== "number"
  ) {
    // Also covers a genuine pre-handshake server — indistinguishable from
    // here, and either way this shell shouldn't proceed.
    return {
      ok: false,
      error: "That address answered, but it isn't a looped meet server.",
    }
  }
  if (CLIENT_PROTOCOL < body.minClientProtocol) {
    return {
      ok: false,
      error: `That server needs a newer version of looped meet (it runs ${body.version ?? "a newer build"}). Update the app and try again.`,
    }
  }
  if (body.protocol < MIN_SERVER_PROTOCOL) {
    return {
      ok: false,
      error: `That server is too old for this app (it runs ${body.version ?? "an older build"}). It needs upgrading.`,
    }
  }
  return { ok: true, server: body }
}

// ---- Sign in with browser -------------------------------------------------
// The browser (already signed into GitHub & co) completes the Auth0 login;
// the server mints a one-time code that comes back via the looped-meet://
// deep link (or pasted by hand in dev). The code is PKCE-style bound to
// this verifier, which never leaves the process — a leaked deep-link URL
// can't be exchanged by anyone else.
let pendingVerifier = null

async function startBrowserSignIn() {
  const base = serverUrl()
  if (!base) return { ok: false, error: "Connect to a server first." }
  pendingVerifier = crypto.randomBytes(32).toString("base64url")
  const challenge = crypto
    .createHash("sha256")
    .update(pendingVerifier)
    .digest("base64url")
  try {
    const res = await fetch(new URL("/api/desktop/auth/start", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(String(res.status))
    const { requestId } = await res.json()
    await shell.openExternal(
      new URL(`/desktop/auth?request=${requestId}`, base).toString(),
    )
    return { ok: true }
  } catch {
    pendingVerifier = null
    return { ok: false, error: "Couldn't start sign-in with that server." }
  }
}

/** Exchange the one-time code for the desktop session cookie. Uses the
 * default session's fetch so the Set-Cookie lands in the same cookie jar
 * the main window and tray polling use. */
async function completeBrowserSignIn(code) {
  const base = serverUrl()
  if (!base) return { ok: false, error: "Connect to a server first." }
  if (!pendingVerifier) {
    return { ok: false, error: "Start the sign-in from the app first." }
  }
  try {
    const res = await session.defaultSession.fetch(
      new URL("/api/desktop/session", base).toString(),
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          verifier: pendingVerifier,
          deviceName: `${process.platform} · looped meet ${app.getVersion()}`,
        }),
        signal: AbortSignal.timeout(5000),
      },
    )
    if (!res.ok) {
      return { ok: false, error: "That code is invalid, expired, or used." }
    }
    pendingVerifier = null
    BrowserWindow.getAllWindows().forEach((w) => w.close())
    showWorkspace()
    void pollPresence()
    return { ok: true }
  } catch {
    return { ok: false, error: "Couldn't reach the server." }
  }
}

/** looped-meet://auth?code=...&server=... from the OS (deep link). The
 * server param must match the configured server — a link from anywhere
 * else is ignored rather than letting it steer the exchange. */
function handleDeepLink(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return
  }
  if (url.protocol !== "looped-meet:" || url.hostname !== "auth") return
  const code = url.searchParams.get("code")
  const from = url.searchParams.get("server")
  const base = serverUrl()
  if (!code || !base || !from || new URL(from).origin !== new URL(base).origin)
    return
  void completeBrowserSignIn(code)
}

function deepLinkFromArgv(argv) {
  return argv.find((arg) => arg.startsWith("looped-meet://")) ?? null
}

function createConnectWindow(step, params = {}) {
  const win = new BrowserWindow({
    width: 460,
    height: 380,
    resizable: false,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "connect-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(path.join(__dirname, "connect.html"), {
    query: step ? { step, ...params } : params,
  })
  return win
}

/** Whether the configured server has accounts and this shell isn't signed
 * in — if so, launching lands on the browser sign-in step, not a workspace
 * that would only show the web login inside the shell. */
async function needsSignIn() {
  const base = serverUrl()
  if (!base) return false
  try {
    const res = await session.defaultSession.fetch(
      new URL("/api/me", base).toString(),
      { credentials: "include", signal: AbortSignal.timeout(5000) },
    )
    const data = await res.json()
    return data.authMode !== "none" && !data.user
  } catch {
    return false
  }
}

/** Branded splash shown the instant a workspace window starts loading —
 * same dimensions as the main window so the swap doesn't visibly jump. */
function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    icon: APP_ICON,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(path.join(__dirname, "loading.html"))
  return win
}

function createMainWindow(url) {
  const loading = createLoadingWindow()

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    icon: APP_ICON,
    show: false,
    // Frameless-feeling chrome: the web app's sidebar header is the drag
    // region (it detects the Electron UA and pads for the traffic lights).
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "workspace-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadURL(url)

  // Swap from the splash to the real window once the workspace reports
  // itself ready (see workspace-preload.js / apps/web's $desktopReady
  // store), or after the timeout, whichever comes first. Guarded so it
  // only ever runs once — the ready signal and the timer both call it.
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    clearTimeout(readyTimer)
    ipcMain.removeListener("workspace-ready", finish)
    if (win.isDestroyed()) return
    win.show()
    win.focus()
    if (!loading.isDestroyed()) loading.destroy()
  }
  const readyTimer = setTimeout(finish, STARTUP_READY_TIMEOUT_MS)
  ipcMain.on("workspace-ready", finish)

  // A server that can't be reached leaves an empty window with no
  // explanation and no way out — the shell has no chrome of its own to
  // report through. Fall back to the connect screen, which can at least say
  // what failed and let a different address be entered.
  win.webContents.on("did-fail-load", (_e, code, description, failedUrl, isMainFrame) => {
    // Sub-resources and in-page navigations fail routinely and harmlessly;
    // only a failed main-frame load means there's nothing to show. -3 is
    // ABORTED, which fires on ordinary navigation away from a page.
    if (!isMainFrame || code === -3) return
    console.warn(`workspace load failed (${code} ${description}): ${failedUrl}`)
    settled = true
    clearTimeout(readyTimer)
    ipcMain.removeListener("workspace-ready", finish)
    if (!loading.isDestroyed()) loading.destroy()
    win.destroy()
    createConnectWindow("failed", { reason: description, url: failedUrl })
  })
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
    if (!loading.isDestroyed()) loading.destroy()
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

/**
 * Application menu. Everything the shell offers lives here — there is no
 * tray icon: a menu-bar icon competes for space users have already run out
 * of, and hides its contents behind an icon nobody recognises. The standard
 * macOS place to look is the app menu, so that is where these live.
 *
 * Rebuilt whenever presence or update state changes, since menu templates
 * are snapshots — Electron copies them at build time rather than tracking
 * the values.
 */
function rebuildAppMenu(channels = lastChannels) {
  lastChannels = channels
  const channelItems =
    channels === null
      ? [{ label: "Sign in to see channels", enabled: false }]
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
  // Only present once an update is staged — the restart is offered, never
  // forced, and sits directly under the check that found it.
  const updateItems = updateReady
    ? [
        {
          label: `Restart to update to ${updateReady.version}`,
          click: () => restartToUpdate(),
        },
      ]
    : []

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.getName(),
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Check for Updates…",
            click: () => void checkForUpdatesInteractive(),
          },
          ...updateItems,
          { type: "separator" },
          {
            label: "Launch at Login",
            type: "checkbox",
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) =>
              app.setLoginItemSettings({ openAtLogin: item.checked }),
          },
          {
            label: "Change Server…",
            click: () => {
              saveSettings({ serverUrl: null })
              mainWindow?.close()
              createConnectWindow()
            },
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      // Without an Edit menu the standard shortcuts don't reach the web app,
      // so cut/copy/paste and select-all stop working in every text field.
      { role: "editMenu" },
      {
        label: "Channels",
        submenu: [
          { label: "Open Looped Meet", click: () => showWorkspace() },
          { type: "separator" },
          ...channelItems,
        ],
      },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  )
}

// ---- Auto-update ----------------------------------------------------------
// Updates come from the GitHub Releases feed the release workflow publishes
// (electron-builder writes latest-mac.yml alongside the zip). macOS requires
// the update to be signed by the same Developer ID as the installed app —
// an unsigned build silently never updates, which is part of why the release
// workflow fails a tagged build that isn't properly signed.

/** How often to re-check while the app stays open. This app runs for weeks,
 * so a launch-only check would leave long-lived sessions permanently stale. */
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

function initAutoUpdates() {
  // electron-updater throws without an app-update.yml, which only exists in a
  // packaged build. Dev runs skip it entirely rather than crash on launch.
  if (!app.isPackaged) return

  // Download in the background, but never restart under the user — someone
  // mid-meeting must not have the app quit out from under them. The update
  // installs on the next quit, or immediately if they pick the tray item.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on("update-downloaded", (info) => {
    updateReady = info
    rebuildAppMenu()
    new Notification({
      title: "Update ready",
      body: `looped meet ${info.version} installs when you restart.`,
    }).show()
  })

  // Update failures are never fatal and never interrupt: a server that can't
  // be reached, a rate limit, or an unsigned build all land here, and the
  // right response is to carry on and retry on the next tick.
  autoUpdater.on("error", (err) => {
    console.warn("auto-update failed:", err?.message ?? err)
  })

  void autoUpdater.checkForUpdates().catch(() => {})
  updateTimer = setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => {})
  }, UPDATE_CHECK_INTERVAL_MS)
}

/**
 * Menu-initiated update check. The automatic checks are silent by design —
 * they must not interrupt — but a check someone asked for has to answer,
 * including when the answer is "nothing to do". Without that it's
 * indistinguishable from a broken button.
 */
async function checkForUpdatesInteractive() {
  if (!app.isPackaged) {
    new Notification({
      title: "Updates unavailable",
      body: "This is a development build — updates only apply to installed releases.",
    }).show()
    return
  }
  if (updateReady) {
    // Already downloaded; the restart item sits directly below in the menu.
    new Notification({
      title: "Update ready",
      body: `looped meet ${updateReady.version} installs when you restart.`,
    }).show()
    return
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    // updateInfo always comes back; compare against what's running to tell
    // "found something newer" from "already current".
    const found = result?.updateInfo?.version
    if (found && found !== app.getVersion()) {
      new Notification({
        title: "Downloading update",
        body: `looped meet ${found} is downloading — you'll be told when it's ready.`,
      }).show()
    } else {
      new Notification({
        title: "Up to date",
        body: `looped meet ${app.getVersion()} is the latest version.`,
      }).show()
    }
  } catch (err) {
    new Notification({
      title: "Couldn't check for updates",
      body: err?.message ?? "The update server couldn't be reached.",
    }).show()
  }
}

/** Quit and apply a staged update. Windows are closed explicitly first:
 * `window-all-closed` is preventDefault'd to keep the app alive, so the
 * usual quit path would otherwise leave them hanging around. */
function restartToUpdate() {
  BrowserWindow.getAllWindows().forEach((w) => w.destroy())
  autoUpdater.quitAndInstall()
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
  rebuildAppMenu(channels)
  notifyJoins(channels)
}

// Deep links need a single instance: on Windows/Linux the OS launches a
// second process with the URL in argv, which we forward to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on("second-instance", (_e, argv) => {
  const link = deepLinkFromArgv(argv)
  if (link) handleDeepLink(link)
  else showWorkspace()
})
// macOS delivers deep links here; register before ready.
app.on("open-url", (e, url) => {
  e.preventDefault()
  handleDeepLink(url)
})
if (app.isPackaged) {
  app.setAsDefaultProtocolClient("looped-meet")
} else if (process.argv[1]) {
  // Dev: the protocol has to point at electron + this project explicitly.
  app.setAsDefaultProtocolClient("looped-meet", process.execPath, [
    path.resolve(process.argv[1]),
  ])
}

app.whenReady().then(() => {
  // Packaged macOS builds get the icon from the .icns; dev runs need it set
  // on the dock explicitly.
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(nativeImage.createFromPath(APP_ICON))
  }
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
    const shake = await handshake(base)
    if (!shake.ok) return { ok: false, error: shake.error }
    saveSettings({ serverUrl: base })
    // Servers with accounts get the browser sign-in step; auth-less
    // deployments (and already-signed-in shells) go straight in.
    const signIn = await needsSignIn()
    if (!signIn) {
      BrowserWindow.getAllWindows().forEach((w) => w.close())
      showWorkspace()
    }
    return { ok: true, needsSignIn: signIn }
  })

  ipcMain.handle("suggested-server", () => suggestedServerUrl())
  ipcMain.handle("sign-in-with-browser", () => startBrowserSignIn())
  ipcMain.handle("submit-auth-code", (_e, code) =>
    completeBrowserSignIn(String(code ?? "").trim()),
  )

  rebuildAppMenu(null)
  presenceTimer = setInterval(() => void pollPresence(), 15_000)
  void pollPresence()
  initAutoUpdates()

  // One keystroke from anywhere back to the workspace.
  globalShortcut.register("CommandOrControl+Shift+M", () => showWorkspace())

  if (serverUrl()) {
    // Signed-out shells land on the browser sign-in step rather than a
    // workspace that would only offer the in-window web login.
    void needsSignIn().then((signIn) => {
      if (signIn) createConnectWindow("signin")
      else showWorkspace()
    })
  } else {
    createConnectWindow()
  }

  app.on("activate", () => {
    if (serverUrl()) showWorkspace()
  })
})

// Closing the window keeps the shell (and its presence polling) alive rather
// than quitting — reopening from the dock is instant, and Quit lives in the
// app menu.
app.on("window-all-closed", (e) => {
  e?.preventDefault?.()
})

app.on("will-quit", () => {
  globalShortcut.unregisterAll()
  if (presenceTimer) clearInterval(presenceTimer)
  if (updateTimer) clearInterval(updateTimer)
})
