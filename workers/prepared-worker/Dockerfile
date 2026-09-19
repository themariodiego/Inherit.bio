# Image for workers/prepared-worker: one `pnpm worker:prepared --once` run per
# container start, then exit. The build context is the repository root
# (wrangler.json sets image_build_context to ../..), filtered by the root
# .dockerignore, so only what is COPYed below reaches the image.
#
# Node 24 matches the production Vercel runtime, not the CI runner.
FROM node:24-bookworm-slim

# Corepack downloads the pnpm pinned by package.json#packageManager on first
# use; without a terminal it must not stop to ask.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app
RUN chown node:node /app

# Everything from here on runs as the unprivileged node user, so the pnpm that
# corepack caches during the build is the one the container finds at run time.
USER node

# Dependencies first, so a source change does not invalidate the install layer.
# devDependencies are required: the entry runs through tsx, which is one, so
# NODE_ENV stays unset and --prod=false is explicit.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack pnpm install --frozen-lockfile --ignore-scripts --prod=false

# tsconfig.json carries the @/ path alias tsx resolves. next.config.ts and
# next-env.d.ts are Next.js build inputs the worker never reads.
COPY --chown=node:node tsconfig.json ./
# The operator entry and the shim that resolves the `server-only` marker for a
# plain Node process (see scripts/server-only-shim.mjs).
COPY --chown=node:node scripts/prepared-worker.run.mts scripts/server-only-shim.mjs ./scripts/
# data/ref/chain is read from the working directory at run time.
COPY --chown=node:node data ./data
# The route register is imported by the worker module (src/lib/uploads/
# own-preparation-worker.ts); the rest of docs/ stays out of the image.
COPY --chown=node:node docs/route-register.json ./docs/route-register.json
COPY --chown=node:node src ./src

# Secrets and configuration arrive only through the container start options
# set by src/index.mjs; nothing is baked into the image.
CMD ["corepack", "pnpm", "worker:prepared", "--once"]
