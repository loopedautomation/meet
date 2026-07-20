# Built with the repo root as context (see docker-compose.yaml) so it can
# copy the shared Infisical entrypoint.
FROM alpine:3 AS infisical
ARG TARGETARCH
ARG INFISICAL_VERSION=0.43.100
RUN apk add --no-cache curl tar \
 && curl -fsSL "https://github.com/Infisical/cli/releases/download/v${INFISICAL_VERSION}/cli_${INFISICAL_VERSION}_linux_${TARGETARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin infisical \
 && infisical --version

# Bakes the agent config into the image — file bind mounts break on hosts
# (e.g. Coolify) that pre-create mount sources as directories.
FROM ghcr.io/loopedautomation/agent:latest

# gh from the official release, not apk: Alpine's github-cli lags upstream by
# months. gh is a static Go binary, so the release tarball runs fine on musl.
# Arch is derived from uname -m rather than TARGETARCH so the classic (non-
# BuildKit) builder works too.
ARG GH_VERSION=2.96.0
USER root
RUN apk add --no-cache git \
 && case "$(uname -m)" in aarch64) arch=arm64 ;; x86_64) arch=amd64 ;; *) echo "unsupported arch" && exit 1 ;; esac \
 && wget -qO /tmp/gh.tar.gz \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${arch}.tar.gz" \
 && tar -xzf /tmp/gh.tar.gz -C /tmp \
 && mv "/tmp/gh_${GH_VERSION}_linux_${arch}/bin/gh" /usr/local/bin/gh \
 && rm -rf /tmp/gh.tar.gz "/tmp/gh_${GH_VERSION}_linux_${arch}" \
 && gh --version
USER looped

COPY examples/datamaker-github-agent/agent.yaml /agent/agent.yaml
COPY examples/datamaker-github-agent/skills/gh-issues.md /agent/skills/gh-issues.md
COPY --from=infisical /usr/local/bin/infisical /usr/local/bin/infisical
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Wraps the base image's launch command with `infisical run` when credentials
# are present. CMD mirrors the base image's ENTRYPOINT + CMD exactly — if the
# base image's launch command changes, update this to match
# (docker image inspect ghcr.io/loopedautomation/agent:latest).
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["deno", "run", "--allow-env", "--allow-read=/agent,/skills,/data,/looped,/deno-dir,/run/secrets", "--allow-write=/data", "--allow-net", "--allow-run=bash,deno", "packages/cli/main.ts", "run", "/agent/agent.yaml"]
