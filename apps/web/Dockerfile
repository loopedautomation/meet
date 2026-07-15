FROM node:22-alpine AS base
RUN corepack enable pnpm

FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile=false --filter @meet/web... --filter .

FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# Public env baked at build time; override NEXT_PUBLIC_LIVEKIT_URL via build arg if needed
ARG NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
ENV NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL
RUN cd apps/web && pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
