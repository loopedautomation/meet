# Upgrading

## To the accounts + channels release (Phase 0)

This release adds Postgres, optional Auth0 accounts, and persistent voice
channels. **Existing deployments keep working without any of it** — see
compatibility below.

### What's new in the stack

- A `postgres` service joins docker-compose (its data lives in the
  `pg-data` volume; it is never published to the host — the debug override
  exposes `127.0.0.1:55432` for local dev only).
- The web container runs schema migrations at boot, before serving
  traffic. A failed migration crash-loops the container visibly — check
  `docker compose logs web`.
- LiveKit delivers webhooks to the web app (presence for the channel
  list). This is configured automatically in `LIVEKIT_CONFIG`.

### Upgrade steps

1. `git pull` (or `docker compose pull` on prebuilt images)
2. Production only: set `POSTGRES_PASSWORD` to a real secret (the
   `meet-dev-only` default is refused in production).
3. `docker compose up -d`

That's it for the accountless product: no login UI appears, `/r/<slug>`
links, the management password, waiting rooms and host keys behave exactly
as before. Postgres sits idle apart from presence rows.

### Turning on accounts (Auth0)

1. Create a Regular Web Application in your Auth0 tenant. Allowed callback
   URL: `https://<your-instance>/auth/callback`; allowed logout URL:
   `https://<your-instance>`.
2. Set the env (Infisical `/apps/web`, or `.env` locally):
   `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`,
   `AUTH0_SECRET` (`openssl rand -hex 32`), `APP_BASE_URL`
   (`https://<your-instance>`).
3. Restart. **The first login on the instance claims the owner role.** Do
   it yourself, promptly.
4. Everyone else joins through invite links (owner/admins mint them via
   `POST /api/invites`; UI arrives with the sidebar). Membership only ever
   happens by the member accepting an invite — there is no "add member".

To force the pre-accounts behavior even with Auth0 env present, set
`MEET_AUTH_MODE=none`.

### Behavior changes for signed-in members

- Members join rooms with a stable identity (`u_<userId>`). LiveKit allows
  one active connection per identity per room, so opening the same room in
  a second tab disconnects the first — guests are unaffected.
- Instance owners/admins can start and host any meeting without the host
  key, and hold host powers in every channel.

### Rollback

Previous images ignore Postgres entirely; the `pg-data` volume is inert.
`IMAGE_TAG=<previous> docker compose up -d` and everything behaves as
before the upgrade.
