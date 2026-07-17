FROM node:22-bookworm-slim AS base
RUN corepack enable pnpm

# Infisical CLI — lets the entrypoint pull secrets at container start (see
# docker-entrypoint.sh). Pinned static Go binary from GitHub releases.
FROM alpine:3 AS infisical
ARG TARGETARCH
ARG INFISICAL_VERSION=0.43.100
RUN apk add --no-cache curl tar \
 && curl -fsSL "https://github.com/Infisical/cli/releases/download/v${INFISICAL_VERSION}/cli_${INFISICAL_VERSION}_linux_${TARGETARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin infisical \
 && infisical --version

FROM base AS build
WORKDIR /repo
COPY package.json pnpm-workspace.yaml ./
COPY apps/agent-bridge/package.json apps/agent-bridge/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile=false --filter @meet/agent-bridge... --filter .
COPY packages/shared packages/shared
COPY apps/agent-bridge apps/agent-bridge
RUN cd apps/agent-bridge && pnpm build

FROM base AS runner
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo ./
COPY agents.yaml /app/agents.yaml
ENV AGENTS_CONFIG=/app/agents.yaml
COPY --from=infisical /usr/local/bin/infisical /usr/local/bin/infisical
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
WORKDIR /repo/apps/agent-bridge
EXPOSE 8090
# The entrypoint wraps the command with `infisical run` when credentials are
# present, so secrets are fetched fresh at start (no baked .env).
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
