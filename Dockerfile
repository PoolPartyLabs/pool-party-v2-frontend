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
# Stage 3: production runner (lean standalone server)
# =============================================================================
FROM base AS runner
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
