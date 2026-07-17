#!/bin/sh
# Wrap the container's command with `infisical run` so secrets are pulled
# fresh from Infisical at container start, instead of baking a .env into the
# image. Mirrors the monorepo's entrypoint. See docker-compose.yaml for the
# env vars this reads.
#
# Auth (pick one, checked in this order):
#   INFISICAL_TOKEN                         — a service token / machine-identity
#                                             access token, used directly.
#   INFISICAL_CLIENT_ID + INFISICAL_CLIENT_SECRET
#                                           — machine-identity Universal Auth;
#                                             we exchange these for a token here.
#
# Config:
#   INFISICAL_PROJECT_ID    workspace/project id (required for run)
#   INFISICAL_ENV           environment slug          (default: prod)
#   INFISICAL_SECRETS_PATH  space-separated secret folder path(s) (default: /)
#                           e.g. "/apps/web /shared" — merges both folders, so
#                           vars common to multiple apps (e.g. BRIDGE_TOKEN)
#                           live once under /shared instead of being
#                           duplicated per app. The app-specific path must
#                           come first: infisical run resolves --path
#                           collisions in first-wins order, so /shared (listed
#                           last) only fills in vars the app path doesn't
#                           already define.
#   INFISICAL_API_URL       self-hosted API base url  (read natively by the CLI)
#
# If no Infisical credentials are present we exec the command unchanged, so
# local `docker compose up` keeps working off the root .env file.
set -e

if [ -z "$INFISICAL_TOKEN" ] && [ -n "$INFISICAL_CLIENT_ID" ] && [ -n "$INFISICAL_CLIENT_SECRET" ]; then
  INFISICAL_TOKEN="$(infisical login --method=universal-auth \
    --client-id="$INFISICAL_CLIENT_ID" \
    --client-secret="$INFISICAL_CLIENT_SECRET" \
    --plain --silent)"
  export INFISICAL_TOKEN
fi

if [ -n "$INFISICAL_TOKEN" ]; then
  # Build one --path flag per space-separated entry in INFISICAL_SECRETS_PATH.
  # Left unquoted deliberately so it word-splits into multiple --path=X args;
  # "$@" (the container's actual command) is untouched.
  path_flags=""
  for path in ${INFISICAL_SECRETS_PATH:-/}; do
    path_flags="$path_flags --path=$path"
  done

  # shellcheck disable=SC2086
  exec infisical run \
    --projectId="$INFISICAL_PROJECT_ID" \
    --env="${INFISICAL_ENV:-prod}" \
    $path_flags \
    --silent \
    -- "$@"
fi

echo "docker-entrypoint: no Infisical credentials found, starting without injection" >&2
exec "$@"
