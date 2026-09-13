# syntax=docker/dockerfile:1
#
# Pool Party v2 frontend — production image for the dev deploy (INT-DEPLOY).
# Multi-stage Next.js standalone build (needs `output: "standalone"` in next.config.ts).
# Built + pushed by scripts/push_image.sh; run on the dev host via docker-compose.
#
# Env split: NEXT_PUBLIC_* are BAKED here at build time (from the build-only .env.production that
# push_image.sh derives from .env.dev). Server-only secrets (PP_API_KEY, PP_API_URL, ANALYTICS_API_URL,
# PP_ANALYTICS_USER_ID_SECRET) are NEVER in the image — they are injected at runtime via the
# compose env_file.
#
# ---------------------------------------------------------------------------------------------
# OPTIONAL hookrisk runtime (WITH_HOOKRISK, hackathon demo only). Default 0.
#
#   docker build -t pool-party-v2 .                                   # unchanged, alpine, no hookrisk
#   docker build --build-arg WITH_HOOKRISK=1 \
#                --build-context hookrisk=./hookrisk \
#                -t pool-party-v2:hookrisk .                          # + Foundry, Python, slither, hookrisk CLI
#
# Why a NAMED BUILD CONTEXT rather than a `COPY hookrisk/`: `.dockerignore` excludes `hookrisk`
# from the build context, deliberately, so the default image never carries a toolchain the app does
# not use. Un-excluding it would put 3 MB of Solidity and Python into every `COPY . .` and change
# the default build. A named context is additive instead: it is resolved only by the `hookrisk-1`
# stage, which is unreachable when WITH_HOOKRISK=0, so the default build never needs the flag and
# produces a byte-identical image to the one before this block existed.
# ---------------------------------------------------------------------------------------------
ARG WITH_HOOKRISK=0

FROM node:22-alpine AS base
# pnpm via corepack, pinned to the repo's packageManager version.
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate

# =============================================================================
# Stage 1: install dependencies
# =============================================================================
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
# --ignore-scripts: skip husky's `prepare` (no .git in the build) and other postinstall hooks.
RUN pnpm install --frozen-lockfile --ignore-scripts

# =============================================================================
# Stage 2: build the application
# =============================================================================
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
# The build context carries the source + the build-only .env.production (NEXT_PUBLIC_* only); node_modules
# and secret env files are excluded via .dockerignore.
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=3072"

# Stable Server Actions encryption key (POO-673). push_image.sh passes this from .env.<env> as a
# build-arg. Baking a CONSISTENT key keeps Server Action IDs identical across every build, so a
# browser holding a slightly-stale bundle after a redeploy still resolves the action instead of
# failing with "Failed to find Server Action". Server-only secret (NOT a NEXT_PUBLIC_ value); Next
# reads it at build time and never ships it to the client (only its own encrypted action refs).
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}

# Next bakes NEXT_PUBLIC_* into the client bundle here, reading .env.production from the context.
RUN pnpm build

# =============================================================================
# Stage 3a: the runtime BASE, selected by WITH_HOOKRISK
#
# `runtime-0` is the default and adds nothing at all: `FROM base AS runtime-0` with no instructions
# is an alias, so the runner below is byte-identical to what it was before this stage existed.
#
# `runtime-1` swaps alpine for Debian slim, which is not a preference either: `foundryup` ships
# glibc binaries and slither's wheels are manylinux, so neither installs on musl without a source
# build. Node stays at 22, matching `base`.
# =============================================================================
FROM base AS runtime-0

FROM node:22-bookworm-slim AS runtime-1
ENV DEBIAN_FRONTEND=noninteractive
# git: `make deps` clones the pinned v4 sources. curl + ca-certificates: foundryup.
# python3 + pip: slither. build-essential is NOT installed; every wheel we need is prebuilt.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates curl git python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

# Foundry, installed system-wide so the non-root runtime user can reach it without a HOME of its own.
ENV FOUNDRY_DIR=/opt/foundry
ENV PATH="/opt/foundry/bin:${PATH}"
RUN curl -L https://foundry.paradigm.xyz | bash \
  && /opt/foundry/bin/foundryup \
  && forge --version

# Slither in its own venv (Debian marks the system interpreter externally-managed, PEP 668).
RUN python3 -m venv /opt/slither-venv \
  && /opt/slither-venv/bin/pip install --no-cache-dir 'slither-analyzer>=0.11.5,<0.12'
ENV HOOKRISK_SLITHER_BIN=/opt/slither-venv/bin/slither

# The hookrisk checkout, from the NAMED BUILD CONTEXT (see the header). Only this stage reads it.
COPY --from=hookrisk / /opt/hookrisk
ENV HOOKRISK_HOME=/opt/hookrisk
# The CLI build, the Slither detector plugin, and the pinned Solidity dependencies the harness needs
# (`make deps` = scripts/fetch-deps.sh, which clones harness/deps.lock at its exact commits).
RUN cd /opt/hookrisk/cli && npm ci && npm run build \
  && /opt/slither-venv/bin/pip install --no-cache-dir -e /opt/hookrisk/detectors \
  && /opt/hookrisk/scripts/fetch-deps.sh \
  && node /opt/hookrisk/cli/dist/cli.js --version

# solc lives in a shared, world-writable place rather than the runtime user's HOME: the container
# runs as a non-root system user, and a first scan that has to download a compiler into a directory
# it may not own is a five-minute surprise on stage. Warming the harness build here pre-fetches
# solc 0.8.26 and compiles v4-core once, at build time.
ENV SVM_HOME=/opt/svm
RUN mkdir -p /opt/svm \
  && (cd /opt/hookrisk/harness && forge build || true) \
  && chmod -R a+rwX /opt/svm \
  && chmod -R a+rX /opt/foundry /opt/hookrisk \
  && chmod -R a+rwX /opt/hookrisk/harness/out /opt/hookrisk/harness/cache 2>/dev/null || true

# =============================================================================
# Stage 3: production runner (lean standalone server)
# =============================================================================
FROM runtime-${WITH_HOOKRISK} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Same stable Server Actions key at RUNTIME (POO-673): Next reads it to DECRYPT incoming action
# requests, so the runner needs the identical value the builder baked. Re-declared here because ARG
# scope is per-stage. Passed via the same build-arg from push_image.sh (server-only; a low-sensitivity
# dev value baked into the dev image — prod injects its own key via the runtime env, not the image).
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}

# Non-root runtime user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Static assets + the traced standalone server (no full node_modules, no env files).
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
