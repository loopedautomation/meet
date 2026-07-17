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

# Streaming ASR model for the platform transcriber (sherpa-onnx streaming
# zipformer, English, 16 kHz). Only the int8 encoder/joiner + decoder +
# tokens are kept — roughly 150 MB in-image.
FROM alpine:3 AS asrmodel
RUN apk add --no-cache curl tar bzip2 \
 && curl -fsSL "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2" \
    | tar -xj -C /opt \
 && cd /opt/sherpa-onnx-streaming-zipformer-en-2023-06-26 \
 && find . -maxdepth 1 -type f \
      ! -name 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx' \
      ! -name 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx' \
      ! -name 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx' \
      ! -name 'tokens.txt' -delete \
 && rm -rf test_wavs \
 && curl -fsSL -o /opt/gtcrn_simple.onnx \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/gtcrn_simple.onnx"

FROM base AS runner
# CA roots for the Infisical CLI (Go) — bookworm-slim ships without a usable
# CA store, so TLS to the Infisical API fails with "unknown authority".
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo ./
COPY --from=asrmodel /opt/sherpa-onnx-streaming-zipformer-en-2023-06-26 /opt/asr-model
COPY --from=asrmodel /opt/gtcrn_simple.onnx /opt/asr-model/gtcrn_simple.onnx
ENV TRANSCRIBER_MODEL_DIR=/opt/asr-model
# Streaming noise suppression (GTCRN, ~0.5 MB) applied per speaker before STT.
ENV DENOISER_MODEL=/opt/asr-model/gtcrn_simple.onnx
# The sherpa-onnx native addon dlopens its shared libraries from the
# platform package's directory; expose it via a stable symlink (the package
# lives under pnpm's store path, which embeds a version hash).
RUN libdir="$(find /repo/node_modules/.pnpm -maxdepth 3 -type d -path '*sherpa-onnx-linux-*/node_modules/sherpa-onnx-linux-*' | head -1)" \
 && test -n "$libdir" && ln -s "$libdir" /opt/sherpa-libs
ENV LD_LIBRARY_PATH=/opt/sherpa-libs
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
