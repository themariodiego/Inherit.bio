# Build tools have network access only while constructing this credential-free
# image. Runtime receives an explicit OUTPUT policy before any app starts.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 iptables openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
