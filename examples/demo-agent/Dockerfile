# Bakes the agent config into the image — file bind mounts break on hosts
# (e.g. Coolify) that pre-create mount sources as directories.
FROM ghcr.io/loopedautomation/agent:latest
COPY agent.yaml /agent/agent.yaml
