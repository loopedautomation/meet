"use client"

import { LiveKitRoom } from "@livekit/components-react"
import type { TokenResponse } from "@meet/shared"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { DisconnectReason, setLogLevel } from "livekit-client"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "react-toastify"
import { Lobby } from "@/components/room/Lobby"
import { MeetingView } from "@/components/room/MeetingView"
import { WaitingRoom } from "@/components/room/WaitingRoom"
import { readVoiceIsolationPref } from "@/hooks/useVoiceIsolation"
import { track } from "@/lib/analytics"
import { consumeExplicitLeave } from "@/lib/leaveIntent"
import { readDevicePref } from "@/stores/devicePrefs"
import { $isHost } from "@/stores/host"
import {
  $autoGain,
  $sendQuality,
  AUTO_RESOLUTION,
  SEND_QUALITY_RESOLUTION,
  type SendQuality,
} from "@/stores/preferences"

const queryClient = new QueryClient()

export type JoinPreferences = {
  displayName: string
  audioEnabled: boolean
  videoEnabled: boolean
  audioDeviceId?: string
  videoDeviceId?: string
}

export function RoomClient({
  slug,
  shareBase,
}: {
  slug: string
  shareBase?: string
}) {
  // Surface connection diagnostics in the console; full debug via env flag.
  useEffect(() => {
    setLogLevel(process.env.NEXT_PUBLIC_LK_DEBUG === "1" ? "debug" : "info")
  }, [])

  const [session, setSession] = useState<{
    token: TokenResponse
    prefs: JoinPreferences
  } | null>(null)
  const [rejoining, setRejoining] = useState(false)
  const [admitted, setAdmitted] = useState(false)
  // Set when the meeting's creator hasn't arrived yet; holds the join
  // preferences so we can retry the same join until the meeting starts.
  const [awaitingStart, setAwaitingStart] = useState<JoinPreferences | null>(
    null,
  )
  // Older booked links carried the room's host key in the URL fragment;
  // current bookings get plain links (hosts claim with the management
  // password instead), but honor the fragment for links already sitting in
  // calendars. Stash it and scrub the address bar so it isn't shared onward
  // by copy-pasting the URL from the browser.
  useEffect(() => {
    try {
      const match = window.location.hash.match(/[#&]hk=([0-9a-f]{64})/)
      if (!match) return
      localStorage.setItem(`hostKey:${slug}`, match[1])
      history.replaceState(null, "", window.location.pathname)
    } catch {}
  }, [slug])

  const joinedAtRef = useRef<number | null>(null)

  const handleJoin = useCallback(
    async (prefs: JoinPreferences, rejoinToken?: string) => {
      setAdmitted(false)
      let hostKey: string | undefined
      try {
        hostKey = localStorage.getItem(`hostKey:${slug}`) ?? undefined
      } catch {}
      try {
        const res = await fetch(`/api/rooms/${slug}/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            displayName: prefs.displayName,
            rejoinToken,
            hostKey,
          }),
        })
        if (res.status === 404) {
          toast.error(
            "This meeting doesn't exist or has already ended. Ask for a fresh link.",
          )
          return
        }
        if (res.status === 425) {
          // The creator hasn't arrived; wait and keep retrying.
          setAwaitingStart(prefs)
          return
        }
        if (!res.ok) throw new Error(`token request failed (${res.status})`)
        const token = (await res.json()) as TokenResponse
        setAwaitingStart(null)
        $isHost.set(token.isHost)
        try {
          // localStorage (not sessionStorage) so the proof survives closing
          // the tab, not just refreshing it.
          localStorage.setItem(
            `rejoin:${slug}`,
            // The token doubles as proof of admission on the next refresh.
            JSON.stringify({ prefs, rejoinToken: token.token }),
          )
        } catch {}
        // A refresh rejoin isn't a new join; waiting-room entries are counted
        // on admission instead.
        if (!rejoinToken && !token.waiting) {
          joinedAtRef.current = Date.now()
          track("room_joined", {
            role: token.isHost ? "host" : "guest",
            via_waiting_room: false,
          })
        }
        setSession({ token, prefs })
      } catch {
        toast.error("Could not join the meeting. Please try again.")
      }
    },
    [slug],
  )

  // A refresh rejoins the meeting automatically; only an explicit leave (or a
  // server-side disconnect) drops back to the lobby.
  useEffect(() => {
    let stored: { prefs: JoinPreferences; rejoinToken?: string } | null = null
    try {
      const raw = localStorage.getItem(`rejoin:${slug}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        // Older entries stored the preferences at the top level.
        stored = parsed.prefs
          ? parsed
          : { prefs: parsed as JoinPreferences, rejoinToken: undefined }
      }
    } catch {}
    if (!stored?.prefs?.displayName) return
    setRejoining(true)
    handleJoin(stored.prefs, stored.rejoinToken).finally(() =>
      setRejoining(false),
    )
  }, [slug, handleJoin])

  // Background token renewal (on admission and the periodic refresh below)
  // used to swallow failures silently, leaving no signal before the stored
  // proof expired mid-meeting. Warn once a couple of consecutive attempts
  // have failed rather than on the first blip.
  const refreshFailCountRef = useRef(0)
  const noteRefreshFailure = useCallback(() => {
    refreshFailCountRef.current += 1
    if (refreshFailCountRef.current < 2) return
    if (toast.isActive(`refresh-fail:${slug}`)) return
    toast.error(
      "Having trouble renewing your connection — you may be disconnected soon. Try reloading if this continues.",
      { toastId: `refresh-fail:${slug}` },
    )
  }, [slug])

  // On admission, swap the stored waiting token for an admitted one while
  // the server can still see us connected as human — so a later refresh
  // walks straight in instead of knocking again.
  const handleAdmitted = useCallback(() => {
    setAdmitted(true)
    joinedAtRef.current = Date.now()
    track("room_joined", { role: "guest", via_waiting_room: true })
    const current = localStorage.getItem(`rejoin:${slug}`)
    if (!current) return
    try {
      const stored = JSON.parse(current) as {
        prefs: JoinPreferences
        rejoinToken?: string
      }
      void fetch(`/api/rooms/${slug}/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: stored.prefs.displayName,
          rejoinToken: stored.rejoinToken,
        }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((fresh: TokenResponse | null) => {
          if (fresh && !fresh.waiting) {
            localStorage.setItem(
              `rejoin:${slug}`,
              JSON.stringify({ prefs: stored.prefs, rejoinToken: fresh.token }),
            )
            refreshFailCountRef.current = 0
          } else {
            noteRefreshFailure()
          }
        })
        .catch(() => noteRefreshFailure())
    } catch {}
  }, [slug, noteRefreshFailure])

  // Tokens expire after an hour, and room-scoped API routes (agent invites,
  // admit, doc) authenticate with the stored one — so a meeting running past
  // the TTL strands those calls with 401s while the WebRTC session carries on
  // fine. Renew the proof in the background well before it lapses; the server
  // keeps the same identity for a verified refresh.
  useEffect(() => {
    if (!session) return
    const timer = setInterval(
      () => {
        try {
          const raw = localStorage.getItem(`rejoin:${slug}`)
          if (!raw) return
          const stored = JSON.parse(raw) as {
            prefs: JoinPreferences
            rejoinToken?: string
          }
          if (!stored.rejoinToken) return
          void fetch(`/api/rooms/${slug}/token`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              displayName: stored.prefs.displayName,
              rejoinToken: stored.rejoinToken,
              refresh: true,
            }),
          })
            .then((res) => (res.ok ? res.json() : null))
            .then((fresh: TokenResponse | null) => {
              // Never downgrade a good token to a "waiting" one: a failed
              // refresh leaves the old proof in place until it expires.
              if (fresh && !fresh.waiting) {
                localStorage.setItem(
                  `rejoin:${slug}`,
                  JSON.stringify({
                    prefs: stored.prefs,
                    rejoinToken: fresh.token,
                  }),
                )
                refreshFailCountRef.current = 0
              } else {
                noteRefreshFailure()
              }
            })
            .catch(() => noteRefreshFailure())
        } catch {}
      },
      40 * 60 * 1000,
    )
    return () => clearInterval(timer)
  }, [session, slug, noteRefreshFailure])

  // A disconnect fires for an explicit "Leave", a transient network drop, AND
  // a page reload/tab close — LiveKit calls disconnect() on both
  // beforeunload and pagehide, so those report the exact same
  // DisconnectReason.CLIENT_INITIATED as clicking Leave. The reason alone
  // can't tell a real leave from the browser tearing the page down, so
  // CLIENT_INITIATED only counts as terminal when the Leave button marked
  // its intent first (see lib/leaveIntent). Reasons the server itself
  // decided (kicked, superseded, room gone) are always terminal.
  const TERMINAL_DISCONNECT_REASONS = useRef(
    new Set([
      DisconnectReason.DUPLICATE_IDENTITY,
      DisconnectReason.PARTICIPANT_REMOVED,
      DisconnectReason.ROOM_DELETED,
    ]),
  ).current
  const handleDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      if (joinedAtRef.current) {
        track("room_left", {
          duration_seconds: Math.round(
            (Date.now() - joinedAtRef.current) / 1000,
          ),
        })
        joinedAtRef.current = null
      }
      setSession(null)
      const isExplicitLeave =
        reason === DisconnectReason.CLIENT_INITIATED && consumeExplicitLeave()
      if (
        isExplicitLeave ||
        (reason !== undefined && TERMINAL_DISCONNECT_REASONS.has(reason))
      ) {
        try {
          localStorage.removeItem(`rejoin:${slug}`)
        } catch {}
        return
      }
      try {
        const raw = localStorage.getItem(`rejoin:${slug}`)
        if (!raw) return
        const stored = JSON.parse(raw) as {
          prefs: JoinPreferences
          rejoinToken?: string
        }
        void handleJoin(stored.prefs, stored.rejoinToken)
      } catch {}
    },
    [slug, handleJoin, TERMINAL_DISCONNECT_REASONS],
  )

  // Poll while the meeting hasn't started; the successful join clears this.
  useEffect(() => {
    if (!awaitingStart || session) return
    const timer = setInterval(() => void handleJoin(awaitingStart), 5000)
    return () => clearInterval(timer)
  }, [awaitingStart, session, handleJoin])

  if (awaitingStart && !session) {
    // No unauthenticated "start anyway" — it let anyone with the link open
    // (and take over) a meeting before its real host arrived. Starting takes
    // the host key (creator's browser) or the management password, exchanged
    // below for this room's key.
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="animate-pulse font-medium text-lg">
          This meeting hasn't started yet
        </p>
        <p className="text-base-content/60 text-sm">
          You'll join automatically once the host arrives.
        </p>
        <ClaimHost
          slug={slug}
          onClaimed={() => void handleJoin(awaitingStart)}
        />
      </main>
    )
  }

  if (rejoining) {
    return (
      <main className="flex min-h-dvh items-center justify-center gap-3">
        <span className="loading loading-spinner" />
        Rejoining…
      </main>
    )
  }

  if (!session) {
    return <Lobby slug={slug} onJoin={handleJoin} />
  }

  const inWaitingRoom = session.token.waiting && !admitted

  // Phone-sized screens capture portrait video (9:16) — LiveKit's default
  // capture presets are landscape, which is what makes a phone's camera
  // publish a sideways-looking track. Applied as the room's capture default
  // so later camera toggles inherit it too.
  const portraitCapture =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 639px)").matches

  // Seed LiveKit's active device with the chosen input (the lobby writes the
  // same pref useStickyDevices reads). Setting it here means the very first
  // captured track — and every unmute after — uses the picked device rather
  // than the OS default. An empty pref leaves LiveKit on the system default.
  const audioDeviceId =
    session.prefs.audioDeviceId || readDevicePref("audioinput") || undefined
  const videoDeviceId =
    session.prefs.videoDeviceId || readDevicePref("videoinput") || undefined

  return (
    <LiveKitRoom
      token={session.token.token}
      serverUrl={session.token.serverUrl}
      options={{
        // Auto quality adapts to network conditions: simulcast publishes
        // layered resolutions, dynacast pauses layers nobody is consuming,
        // and adaptiveStream sizes what we receive to what's on screen.
        // Congestion control then walks the send bitrate up and down.
        dynacast: true,
        adaptiveStream: true,
        // Keep the browser DSP on and layer enhanced voice isolation on top
        // per the saved preference; where unsupported the extra flag is simply
        // ignored. Set as a capture default so unmuting inherits it too.
        audioCaptureDefaults: {
          deviceId: audioDeviceId,
          voiceIsolation: readVoiceIsolationPref(),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: $autoGain.get(),
        },
        videoCaptureDefaults: {
          deviceId: videoDeviceId,
          // Send-quality cap wins over the portrait default: it exists for
          // uplink-poor connections, which phones often are. "auto" captures
          // 1080p; what actually goes out adapts to the network (simulcast
          // layers + congestion control, dynacast below).
          ...($sendQuality.get() !== "auto"
            ? {
                resolution:
                  SEND_QUALITY_RESOLUTION[
                    $sendQuality.get() as Exclude<SendQuality, "auto">
                  ],
              }
            : portraitCapture
              ? { resolution: { width: 720, height: 1280 } }
              : { resolution: AUTO_RESOLUTION }),
        },
      }}
      // Waiting participants join without media; on admission WaitingRoom
      // brings devices up per the lobby preferences. Otherwise join with the
      // lobby's mic setting — unless others are already in the call, in
      // which case join muted (unmute from the control bar).
      audio={
        !session.token.waiting &&
        session.prefs.audioEnabled &&
        session.token.participantCount === 0 && {
          deviceId: session.prefs.audioDeviceId,
        }
      }
      video={
        !session.token.waiting &&
        session.prefs.videoEnabled && {
          deviceId: session.prefs.videoDeviceId,
        }
      }
      onDisconnected={handleDisconnected}
      onError={(err) => {
        toast.error(
          `Could not connect to the meeting server (${err.message}). ` +
            "Check that the LiveKit server is running and reachable.",
        )
      }}
      className="h-dvh"
    >
      <QueryClientProvider client={queryClient}>
        {inWaitingRoom ? (
          <WaitingRoom prefs={session.prefs} onAdmitted={handleAdmitted} />
        ) : (
          <MeetingView
            slug={slug}
            shareBase={shareBase}
            startedAt={session.token.roomStartedAt}
          />
        )}
      </QueryClientProvider>
    </LiveKitRoom>
  )
}

/**
 * "I'm the host": exchange the deployment's management password for this
 * room's host key. The password crosses the wire once; the browser keeps
 * the per-room key every host-gated route understands. This is how booked
 * meetings (plain links, no creator browser) get their host — and how a
 * host on a new device, or a colleague covering for them, takes over.
 */
function ClaimHost({
  slug,
  onClaimed,
}: {
  slug: string
  onClaimed: () => void
}) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => setOpen(true)}
      >
        I'm the host — start the meeting
      </button>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/rooms/${slug}/claim-host`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        hostKey?: string
        error?: string
      }
      if (!res.ok || !data.hostKey) {
        setError(data.error ?? "could not claim host")
        return
      }
      try {
        localStorage.setItem(`hostKey:${slug}`, data.hostKey)
      } catch {}
      onClaimed()
    } catch {
      setError("network error — try again")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        autoFocus
        type="password"
        className="input input-sm"
        placeholder="Management password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-label="Management password"
      />
      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={busy || !password}
      >
        {busy && <span className="loading loading-spinner loading-xs" />}
        Start
      </button>
      {error && <span className="text-error text-xs">{error}</span>}
    </form>
  )
}
