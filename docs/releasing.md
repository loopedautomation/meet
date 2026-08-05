# Releasing

Two things ship from this repo on separate cadences:

| | Version lives in | Tag | Produces |
|---|---|---|---|
| **Server** | `apps/web` (locked to agent-bridge, shared, db) | `server-v0.2.0` | pinned `:0.2.0` images on GHCR |
| **Desktop** | `apps/desktop` | `v0.1.3` | signed, notarized macOS release |

Branch flow is `feature → next → dev → main`. Releases are cut from `dev`.

## Why the tags look like that

The desktop app **must** use bare semver tags. `electron-updater` walks the
repo's releases, skips any tag that isn't valid semver, and picks the newest
that is — a prefixed tag would be invisible to it and auto-update would
silently never fire. The server is the side that carries a prefix.

`electron-builder` names its GitHub release from `apps/desktop/package.json`,
**not** from the pushed tag. If those disagree the build signs and notarizes
correctly and then uploads nothing, or creates a second release alongside the
first. `scripts/tag-release.sh` derives the tag from package.json so they
cannot drift — don't hand-write release tags.

## Recording a change

Changesets records what changed and computes the next version:

```bash
pnpm changeset          # pick packages + bump type, describe the change
```

Commit the generated file in `.changeset/` with your PR. CI does not require
one, so a change with no user-visible effect can simply skip it.

The four server packages are a `fixed` group: they build into images that
deploy together under a single `IMAGE_TAG`, so a per-package version would be
meaningless. Bumping any one bumps all four. The desktop app is deliberately
outside that group.

## Cutting a release

Once the changes are on `dev`:

```bash
git checkout dev && git pull
pnpm version:packages                       # applies changesets, writes CHANGELOGs
git commit -am "chore: version packages"
git push

pnpm release:desktop                        # tags v<desktop version>
pnpm release:server                         # tags server-v<web version>
```

Each tag triggers its own workflow. The script refuses to run on a dirty tree,
warns when you're not on `dev`, and stops if the tag or a release already
exists — that last check saves a 15-minute signing and notarization run that
would have uploaded nothing.

## What happens next

**Desktop** builds, signs, notarizes, verifies with `codesign` and `spctl`
against the real dmg, and publishes the release with the dmg, zip, blockmaps
and `latest-mac.yml`. Installed apps discover updates from that feed — so a
release is live for existing users the moment it is published, and the zip
(not the dmg) is what they download.

**Server** publishes `:0.2.0` images. Deploying them is a separate step:
merging `dev → main` publishes `:latest` and redeploys production.

## Environments

| Branch | Images | Deploys to |
|---|---|---|
| `dev` | `:dev` | `meet.dev.looped.sh` |
| `main` | `:latest` | `meet.looped.sh` |

Both read their secrets from Infisical at container start — the dev app uses
the **staging** environment, production uses **prod**. Compose interpolates
`LIVEKIT_CONFIG` from the *Coolify* environment, not from Infisical, so
`LIVEKIT_API_KEY` must be set there or livekit refuses to start and takes the
whole stack down with it.
