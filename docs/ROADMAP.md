# Roadmap: from meetings to a communication platform

Where this is going: bridge the gap between Discord, Slack, and Meet.
Today Meet is scheduled/ad-hoc video rooms with first-class AI agents.
The destination is a persistent communication home — accounts, always-open
voice channels, text channels, DMs — where the agents are members, not
guests, and where the differentiator stays: **AI participants that live in
your spaces**, on infrastructure you own.

## Architecture: shared frontend, self-hosted instances

The decision that shapes everything: self-hosted **instances** (the data
plane) all reachable through one shared **frontend** (the control plane).

```
            ┌────────────────────────────────────┐
            │  app.looped.…  (shared frontend)   │
            │  Auth0 identity · instance picker  │
            └────────┬───────────────┬───────────┘
                     │               │
      wss/https      │               │
            ┌────────▼──────┐  ┌─────▼─────────┐
            │ Instance A    │  │ Instance B    │
            │ (self-hosted) │  │ (self-hosted) │
            │ api+livekit+  │  │ api+livekit+  │
            │ bridge+pg     │  │ bridge+pg     │
            └───────────────┘  └───────────────┘
```

- **Shared frontend**: the Next.js app, hosted once at a canonical URL.
  Handles login (Auth0), remembers which instances you belong to, renders
  whatever instance you're connected to. Later: optionally self-host the
  frontend too (it's the same app pointed at your instance).
- **Instance** = today's docker-compose stack + Postgres: the API, LiveKit,
  agent-bridge, and all data (channels, messages, memberships) live on the
  instance. The shared frontend holds **no user content** — it's a viewer.
- **Identity vs membership**: Auth0 authenticates *who you are* (one global
  identity). Each instance decides *what you are there* (member, role,
  permissions) and keeps its own member table keyed by the Auth0 subject.
- **Connectivity**: the frontend talks directly to the instance over
  HTTPS/WSS (CORS'd to the frontend origin). The instance validates Auth0
  JWTs itself (JWKS) — the control plane is never in the data path.
- **Instance discovery**: an invite is `app.…/join/<instance-host>/<code>`
  or a pasted instance URL. A tiny directory service on the control plane
  maps "my instances" per user (the only central state: user ↔ instance
  pointers, no content).

Why this split wins: self-hosters keep full data ownership (Discord can't
offer that), while users get one login and one app for every community
they're in (plain self-hosting can't offer that).

## Phase 0 — Foundations (accounts + persistence)

The enabler for everything else. No user-visible features beyond login.

1. **Postgres** joins the compose stack. Schema v1: `users` (auth0_sub,
   profile), `instances` metadata, `memberships` (user, role),
   `channels`, `channel_members`, `messages`, `invites`. Migrations via
   Drizzle (TS-native, plays well with the monorepo).
2. **Auth0 integration** (we already run Auth0 — reuse it):
   - Frontend: Auth0 SPA/next SDK, session in the shared frontend.
   - Instance API: JWT validation middleware (JWKS, audience per API).
   - Map today's ephemeral display-name identity onto real accounts;
     guests remain possible for meeting links (a guest is a room-scoped
     identity, exactly like today).
3. **Instance API service**: promote the bridge's control API + web API
   routes into an authenticated instance API. Roles v1: owner, admin,
   member, guest.
4. **Control-plane directory**: minimal service (or Next.js API + tiny DB)
   storing user↔instance links and instance public metadata (name, icon,
   host). Registration = instance admin pastes a signed handshake.
5. **Migration/compat**: existing `/r/<slug>` links keep working — a
   meeting room becomes an unlisted, ephemeral voice channel.

Exit criteria: log in once, see your instance(s), open one, and land in
what is functionally today's app — now with a persistent identity.

## Phase 1 — Voice channels (first win)

The smallest step from what exists, and the most differentiated: a voice
channel is **a meeting room that never ends** — no scheduling, no links,
just join.

- `channels` of kind `voice`: persistent LiveKit room name per channel,
  no empty-timeout teardown of the *channel* (the LiveKit room can still
  spin down when empty; the channel is the durable thing).
- **Presence in the sidebar**: who's in each voice channel right now,
  live (LiveKit webhooks → instance API → sidebar subscription). This is
  the Discord magic — seeing "3 people + Scout in #standup" and clicking in.
- Join/leave = one click, camera/mic prefs remembered (already built).
- **Agents as channel members**: an agent can be *assigned* to a voice
  channel (always present when anyone's there, auto-dispatched on first
  join, parked when empty). Registry + per-channel agent config.
- Reuse wholesale: whiteboard, shared doc, transcription, screenshare —
  every room feature is already channel-shaped.
- Text sidecar: each voice channel gets a lightweight persistent chat
  (its meeting chat, now stored in Postgres instead of vanishing).

Exit criteria: an instance has #lounge and #standup in a sidebar; members
drop in and out all day; an agent lives in #standup.

## Phase 2 — Text channels & DMs

The biggest gap vs Slack/Discord: persistent text.

- `channels` of kind `text`: messages in Postgres, infinite scroll,
  edits/deletes, replies (thread-lite: reply-to first, full threads later),
  reactions, file/image attachments (S3-compatible storage config per
  instance), mentions with notifications.
- **DMs and group DMs**: modeled as private channels between N users.
- **Agents in text channels**: @mention an agent anywhere; it answers with
  its brain, tools, doc/whiteboard powers. The bridge's chat-mention
  machinery generalizes from room chat to channels. A DM with an agent is
  a private brain conversation — the TTY protocol already supports it.
- **Escalate text → voice**: "start a huddle" from any text channel/DM
  spins the paired voice room (this is where the Slack-huddle and
  meeting-room DNA fuse).
- Search v1: Postgres full-text over messages.
- Notifications: web push + per-channel mute/settings; unread markers.

## Phase 3 — The connective tissue

- **Shared channels (cross-instance)**: a channel co-hosted by two
  instances, members from both — the Slack Connect analogue, and the
  hardest thing here (message replication or single-home + remote access;
  start with single-home: the channel lives on one instance, the other's
  members access it via the shared frontend's multi-instance session).
- **Roles & permissions v2**: per-channel overrides, agent permissions
  (which channels an agent may join/read), moderation basics.
- **Presence & status**: online/idle/in-a-call, custom status, typing.
- **Scheduled meetings become calendar events on channels** (the cal.com
  integration points at a channel instead of a bare room).
- **Mobile-ready PWA** pass: the sidebar/channel UI must collapse well.

## Phase 4 — Polish & platform

- Threads (full), pinned messages, channel topics.
- Voice channel niceties: soundboard-free zone, but: noise gate defaults,
  temporary breakout channels, stage mode (host-gated speaking — the
  agent turn-policy machinery generalizes to humans).
- Agent workflows: an agent that watches a text channel and files issues;
  channel-scoped agent memory/conversation continuity.
- Admin console per instance: members, invites, agents, retention policy.
- Data lifecycle: retention settings, export, GDPR delete.

## Sequencing summary

| Phase | Headline | New services | Risk |
|---|---|---|---|
| 0 | Accounts (Auth0) + Postgres + instance/control split | postgres, directory | Architecture — get the JWT/CORS/instance handshake right |
| 1 | Voice channels + sidebar presence | — | LiveKit webhook plumbing; agent auto-dispatch |
| 2 | Text channels + DMs + agents in text | object storage | Message model + notifications scope creep |
| 3 | Shared channels, roles v2, presence | — | Cross-instance auth |
| 4 | Threads, stage mode, admin, retention | — | — |

## Open questions (to resolve before Phase 0 starts)

1. **Directory service shape**: fold into the shared frontend (Next.js API
   + small Postgres) or a separate tiny service? Leaning: fold in.
2. **Auth0 tenant strategy**: one tenant for the shared frontend with each
   instance as an API/audience, or per-instance applications? Leaning: one
   tenant, one API audience ("instance-api"), instances validate the same
   JWKS and authorize by membership.
3. **Guest story**: how far do unauthenticated meeting links survive into
   the channel world? (Proposal: guests can join *voice* via invite links,
   never text history.)
4. **Monorepo layout**: `apps/api` as a new service vs growing the bridge?
   Leaning: new `apps/api` (Hono, same stack as the bridge's control API),
   bridge stays real-time/agent-focused.
5. **Existing deployments**: migration path for the current prod instance —
   Phase 0 must ship with a "no accounts yet" compatibility mode flag?
