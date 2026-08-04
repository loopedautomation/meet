#!/bin/sh
# Run the desktop app's dev server, injecting MEET_SERVER_URL from Infisical
# when the CLI is authenticated, falling back to a plain dev server
# otherwise. Desktop only needs that one optional value (see
# apps/desktop/src/main.js), unlike `pnpm dev` which needs Infisical for
# LiveKit/DB secrets — so it must not hard-require a login.
set -e

PROJECT_ID=396f8208-593a-4966-8943-97621affc25a
ENV_SLUG=dev

cd "$(dirname "$0")/.."

if command -v infisical >/dev/null 2>&1 && infisical login status >/dev/null 2>&1; then
  exec infisical run --projectId="$PROJECT_ID" --env="$ENV_SLUG" \
    --path=/apps/desktop --path=/shared \
    -- pnpm --filter @meet/desktop dev
fi

echo "dev-desktop: no Infisical session found, starting without MEET_SERVER_URL injection (set it manually or use the connect screen)" >&2
exec pnpm --filter @meet/desktop dev
