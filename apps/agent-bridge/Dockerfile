FROM node:22-bookworm-slim AS base
RUN corepack enable pnpm

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
WORKDIR /repo/apps/agent-bridge
EXPOSE 8090
CMD ["node", "dist/index.js"]
