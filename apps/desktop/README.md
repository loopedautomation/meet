# looped meet desktop

A thin Electron shell over an instance's member UI. The app owns nothing but
the window: the UI is served by whichever server you connect to (self-hosted
or a hosted team server), so any instance works and UI updates ship
server-side. The shell adds the native layer:

- **Connect to your server** — point it at any meet instance by URL; the
  choice is remembered.
- **Tray presence** — who's in each channel, from the menu bar; click to
  hop in.
- **Global shortcut** — `Cmd/Ctrl+Shift+M` brings the workspace up from
  anywhere.
- **Notifications** — a quiet heads-up when a channel comes alive while
  the app is in the background.
- **Launch at login** — toggle in the tray menu.

## Develop

```sh
pnpm install
pnpm --filter @meet/desktop dev
```

## Package (unsigned, local)

```sh
pnpm --filter @meet/desktop package
```

Signing, notarization and an update feed are release-pipeline work, tracked
on the roadmap.
