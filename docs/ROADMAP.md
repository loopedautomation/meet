# Roadmap: from meetings to the communication home for teams

Where this is going: the communication home for **teams** — Slack-huddle ×
meeting-room × AI teammates. Today Meet is scheduled/ad-hoc video rooms with
first-class AI agents. The destination is a persistent place your team lives
in all day — accounts, always-open voice channels, text channels, DMs — where
the agents are members, not guests, and where the differentiator stays:
**AI teammates that live in your spaces**, on infrastructure you own (or we
run for you).

The target is workgroups first: huddles and DMs over moderation and stage
features, calendar-aware, agents doing real work. Servers are **private
(invite-only) at launch**; public, joinable servers — open communities on
the same machinery — are a later phase, not v1.

## Architecture: open-core standalone instance

The product is **one self-hostable stack**. A team's instance is the entire
thing — no central control plane, no shared frontend, no directory service.

```
        your-team.example.com  (one docker-compose stack)
        ┌──────────────────────────────────────────────┐
        │  web (Next.js: member UI + guest join)       │
        │  postgres (channels, members, messages)      │
        │  livekit (SFU) · agent-bridge (AI members)   │
        └──────────────────────────────────────────────┘
```

- **Instance = server.** One deployment serves one team (or community). All
  data — channels, messages, memberships — lives on the instance.
- **Joining is always the member's own action.** There is no "add person" —
  an admin can only extend an invite; membership exists when the person
  accepts it. Every instance maintains **its own member list from
  scratch** — nothing is imported from the hosted looped platform. Servers
  are private (invite-only); a public "anyone who signs in may join" mode
  comes later (Phase 3).
- **Identity: Auth0** (the same tenant as the hosted looped platform, so one
  login carries across looped products — same account, no new password).
  The instance validates Auth0-issued tokens and keeps its own member table
  keyed by the Auth0 subject — *logging in is not membership*; membership
  comes only from accepting an invite. The integration is standard OIDC
  behind a thin session seam, so bring-your-own-OIDC or local accounts for
  self-hosters is a contained later addition, not a rewrite.
- **Clients: desktop-first for members, web for guests.** Members live in a
  desktop app — an Electron shell that loads the instance's own member UI
  (one frontend codebase, served by the instance, wrapped with tray,
  global shortcuts, native notifications, auto-launch). The browser remains
  the guest surface: `/r/<slug>`, type a name, join — unchanged. Mobile
  comes later via the same served-UI pattern (PWA pass first).
- **Business model:** open source is distribution; the offering is hosted
  **team servers** (the Discourse/Cal.com model) — point the desktop app at
  your self-hosted server, or create a team server with us and we provision
  the same stack on our infra. **No billing at launch**: hosted team
  servers are free for now. When billing lands it is **per instance, not
  per seat** (unlike other looped apps): a server costs what it costs
  regardless of member count. Hosting requires no special architecture,
  only provisioning ops and (later) billing.

### Later / only if needed: a control plane

An earlier version of this roadmap put a shared frontend + directory service
(one login, an instance picker, `app.…/join/<host>/<code>` discovery) ahead
of everything else. That is deferred indefinitely: it solves a problem —
belonging to many instances — that only exists after many instances exist.
Because the desktop shell already "points at an instance", a control plane
can bolt on later without reworking the instance. Revisit alongside
cross-instance shared channels (Phase 3).

## Phase 0 — Foundations (single instance)

The enabler for everything else. No user-visible features beyond login.

1. **Postgres** joins the compose stack, with a new `packages/db` workspace
   (Drizzle schema + committed SQL migrations, run at web startup). Schema
   v1: `users` (auth0_sub, profile), `memberships` (role: owner/admin/
   member), `invites`, `channels`, `channel_members`, `messages` (designed
   now, written in Phase 2), `room_presence`, `instance_settings`. The
   instance *is* the team — no teams table; membership is instance-level.
   Guests are not rows: a guest stays a room-scoped identity, exactly like
   today.
2. **Auth0 login** in the web app (standard OIDC, thin session seam). First
   login claims **owner**. After that, membership comes only from accepting
   an invite URL — no admin-side "add member", no import from the looped
   platform (every server's member list starts from scratch). Members get a
   stable LiveKit identity (`u_<userId>`) so presence resolves to real
   people; guests keep ephemeral identities.
3. **Authenticated API routes**: room creation and channel CRUD accept a
   member session; the management password remains for headless flows and
   compat. Roles v1: owner, admin, member, guest.
4. **LiveKit webhook receiver** + `room_presence` table — the plumbing
   Phase 1's sidebar presence reads. Landed now so Phase 1 is UI, not
   infrastructure.
5. **Compat**: `MEET_AUTH_MODE=none` reproduces today's product exactly —
   no login, management-password gating, `/r/<slug>` guest links, hostKey,
   start gate, waiting room all unchanged in every mode.

Exit criteria: log in once, land in today's app with a persistent identity;
existing deployments upgrade with `docker compose pull && up -d` and nothing
breaks.

## Phase 1 — Voice channels + desktop app (first win)

The smallest step from what exists, and the most differentiated: a voice
channel is **a meeting room that never ends** — no scheduling, no links,
just join.

- `channels` of kind `voice`: persistent channel row, disposable LiveKit
  room (`ch-<id>`, recreated on join — the channel is the durable thing).
  No start gate, no waiting room, survives everyone leaving.
- **Presence in the sidebar**: who's in each voice channel right now, live
  (LiveKit webhooks → `room_presence` → sidebar subscription). This is the
  magic — seeing "3 people + Scout in #standup" and clicking in.
- Join/leave = one click, camera/mic prefs remembered (already built).
- **Agents as channel members**: an agent can be *assigned* to a voice
  channel (always present when anyone's there, auto-dispatched on first
  join, parked when empty). Registry + per-channel agent config.
- **`apps/desktop`: the Electron shell.** Connects to any instance by URL
  ("connect to your server" — hosted or self-hosted, never hard-coded to
  ours) and loads that instance's member UI; adds tray presence ("who's in
  #standup" from the menu bar), a global join shortcut, native
  notifications, auto-launch. Members live here; the browser stays for
  guests.
- Reuse wholesale: whiteboard, shared doc, transcription, screenshare —
  every room feature is already channel-shaped.
- Text sidecar: each voice channel gets a lightweight persistent chat (its
  meeting chat, now stored in Postgres instead of vanishing).

Exit criteria: the team's instance has #lounge and #standup in a sidebar;
members drop in and out all day from the desktop app; an agent lives in
#standup.

## Phase 2 — Text channels & DMs

The biggest gap vs Slack: persistent text.

- `channels` of kind `text`: messages in Postgres, infinite scroll,
  edits/deletes, replies (thread-lite: reply-to first, full threads later),
  reactions, file/image attachments (S3-compatible storage config per
  instance), mentions with notifications.
- **DMs and group DMs** (first-class for teams): modeled as private
  channels between N users.
- **Escalate text → voice: "start a huddle"** from any text channel or DM
  spins up the paired voice room — the Slack-huddle and meeting-room DNA
  fuse here. This is the headline feature of the phase.
- **Agents in text channels**: @mention an agent anywhere; it answers with
  its brain, tools, doc/whiteboard powers. A DM with an agent is a private
  brain conversation — the TTY protocol already supports it.
- Search v1: Postgres full-text over messages.
- Notifications: native (desktop shell) + web push; per-channel mute;
  unread markers.

## Phase 3 — The connective tissue

- **Public servers**: the "anyone who signs in may join" access mode —
  private/invite-only is the only mode until here.
- **Presence & status**: online/idle/in-a-call, custom status, typing.
- **Roles & permissions v2**: per-channel overrides, agent permissions
  (which channels an agent may join/read), admin basics.
- **Scheduled meetings become calendar events on channels** (the cal.com
  integration points at a channel instead of a bare room).
- **Mobile**: wanted, deliberately not now. PWA pass first (the
  sidebar/channel UI must collapse well), native wrapper only if the PWA
  isn't enough — same instance-served-UI pattern as desktop.
- **Cross-instance shared channels** — and with them, the control plane
  question — live here, revisited only if real demand shows up (start
  single-home: the channel lives on one instance).

## Phase 4 — Polish & platform

- Threads (full), pinned messages, channel topics.
- Voice channel niceties: noise gate defaults, temporary breakout channels.
- Agent workflows: an agent that watches a text channel and files issues;
  channel-scoped agent memory/conversation continuity.
- Admin console per instance: members, invites, agents, retention policy.
- Data lifecycle: retention settings, export, GDPR delete.

## Sequencing summary

| Phase | Headline | New pieces | Risk |
|---|---|---|---|
| 0 | Auth0 accounts + Postgres, single instance | postgres, `packages/db`, webhook receiver | Auth SDK fit; migration-at-startup discipline |
| 1 | Voice channels + sidebar presence + desktop shell | `apps/desktop` (Electron) | RoomClient channel mode; agent auto-dispatch; first signed releases |
| 2 | Text channels + DMs + huddle escalation | object storage | Message model + notifications scope creep |
| 3 | Presence/status, roles v2, mobile PWA | — | PWA vs native call |
| 4 | Threads, admin, retention | — | — |

## Resolved decisions (formerly open questions)

1. **Product shape**: open-core standalone instance; hosted per-team
   instances as the business. Control plane (shared frontend + directory)
   deferred indefinitely — see "Later / only if needed".
2. **Identity**: Auth0 for now, for continuity with the hosted looped
   platform (one tenant, one login across products). Kept behind a standard
   OIDC session seam.
3. **Monorepo layout**: no new `apps/api` — grow `apps/web` API routes;
   all schema/DB access lives in `packages/db` so a future standalone API
   service (if ever needed) imports the same package. The bridge stays
   realtime/agent-focused. `apps/desktop` arrives in Phase 1.
4. **Guest story**: guests join *voice* via invite/meeting links —
   room-scoped identity, exactly today's `/r/<slug>` behavior — and never
   see text history.
5. **Existing deployments**: `MEET_AUTH_MODE=none` is the compatibility
   mode; upgrading is pull-and-restart, rollback-safe.

## Open questions

1. **Self-hoster identity**: when does BYO-OIDC / local email+password land
   for instances outside the looped Auth0 tenant? (Not near-term; the
   session seam keeps it cheap. Until then: own Auth0 app or
   `MEET_AUTH_MODE=none`.)
2. **Hosted provisioning mechanics**: "create a team server" provisions a
   per-team instance on our infra, free at launch — how automated does
   that need to be on day one (manual/scripted is fine early)? Billing
   (per instance) is deferred until there's something worth charging for.
