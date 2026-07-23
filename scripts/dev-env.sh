#!/bin/sh
# Regenerate the root .env from Infisical (dev environment) so local dev
# never relies on a hand-maintained .env. Run automatically by `pnpm dev`.
#
# The generated file serves two consumers:
#   - docker compose interpolation (${LIVEKIT_NODE_IP} etc. in LIVEKIT_CONFIG)
#   - each container's env_file fallback (see x-local-env in docker-compose.yaml)
#
# Merge order is first-wins: app paths first, /shared last, matching how
# docker-entrypoint.sh resolves --path collisions with `infisical run`.
set -e

PROJECT_ID=396f8208-593a-4966-8943-97621affc25a
ENV_SLUG=dev
PATHS="/apps/livekit /apps/agent-bridge /apps/demo-agent /shared"

cd "$(dirname "$0")/.."

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

for path in $PATHS; do
  infisical export --projectId="$PROJECT_ID" --env="$ENV_SLUG" --path="$path" --format=dotenv >> "$tmp"
done

# Docker-network topology, not secrets: inside the compose network LiveKit is
# reachable as `livekit`, while Infisical's /shared value (ws://localhost:7880)
# is for the host-run web dev server, which doesn't read this file.
# First occurrence of each key wins, matching infisical run's collision rules.
# Advertise the host's LAN IP as the media address: the browser reaches it
# directly, and containers (agent-bridge) reach it via Docker NAT back to the
# published 7881/7882 ports. 127.0.0.1 would be unreachable from containers,
# so agents would join muted (media never connects).
node_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"

{
  echo "LIVEKIT_URL=ws://livekit:7880"
  echo "LIVEKIT_NODE_IP=$node_ip"
  echo "LIVEKIT_FORCE_TCP=true"
  cat "$tmp"
} | awk -F= '!/^[[:space:]]*(#|$)/ && !seen[$1]++' > .env
echo "dev-env: wrote $(grep -c '=' .env) vars to .env from Infisical ($ENV_SLUG)" >&2
