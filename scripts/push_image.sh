#!/bin/bash
#
# Build + push the Pool Party v2 frontend image to ECR (INT-DEPLOY).
# Mirrors pool-party-interface/scripts/push_image.sh, adapted to this repo (pnpm, standalone).
#
# Usage:  sh scripts/push_image.sh dev  [version-tag]
#         sh scripts/push_image.sh prod [version-tag]
#
# Both dev and prod push :latest PLUS an immutable version tag. The version resolves from, in order:
#   2nd arg  >  PUSH_VERSION env var  >  IMAGE_VERSION in .env.<env>  >  `git describe --tags --always`.
# Set IMAGE_VERSION=vX.Y.Z in .env.dev / .env.prod so every deploy carries a rollback-able tag
# (the deploy host pins that tag and rolls back to a previous one). Build platform defaults to
# linux/arm64 (dev + prod hosts are Graviton); override with PUSH_PLATFORM=linux/amd64.
#
# After this, deploy on the target host (see the deploy-interface-v2 skill for dev):
#   ssh -i <path-to-deploy-key.pem> ec2-user@<dev-host>
#   sudo sh devdeploy.sh
#
# Env split: ONLY NEXT_PUBLIC_* (public) are baked into the image at build time, sourced from
# .env.<env>. Server-only secrets (PP_API_KEY, PP_API_URL, ANALYTICS_API_URL,
# PP_ANALYTICS_USER_ID_SECRET) are NEVER baked — they are injected at runtime via the host's
# compose env_file.

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <environment> [version-tag]   (supported: dev, prod)"
  exit 1
fi

ENVIRONMENT=$1
if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo "Error: environment must be 'dev' or 'prod' (got '$ENVIRONMENT')."
  exit 1
fi

# --- environment configuration -----------------------------------------------
if [ "$ENVIRONMENT" = "dev" ]; then
  ACCOUNT_ID=<aws-account-id-dev>
else
  ACCOUNT_ID=<aws-account-id-prod>
fi
# Exported so a Docker credential helper (see the ECR login section) inherits it. The helper is
# spawned by `docker push`, not by this script, so it resolves the DEFAULT AWS chain unless the
# profile is in the environment.
export AWS_PROFILE=pp-apps-admin-$ENVIRONMENT
AWS_REGION=us-east-2
ECR_REGISTRY=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
IMAGE_NAME=$ECR_REGISTRY/$ENVIRONMENT/pool-party-interface-v2
LOCAL_TAG=pool-party-$ENVIRONMENT-interface-v2
PLATFORM=${PUSH_PLATFORM:-linux/arm64}

# Run from the repo root regardless of where the script was invoked.
cd "$(dirname "$0")/.."

echo "Building Pool Party v2 frontend for '$ENVIRONMENT'"
echo "  Profile:   $AWS_PROFILE"
echo "  Platform:  $PLATFORM"
echo "  Image:     $IMAGE_NAME:latest"

# Read the first value of KEY ($2) from an env file ($1); empty when absent.
env_val() { grep -E "^$2=" "$1" | head -1 | cut -d= -f2- || true; }

# --- build-time env: bake only the public NEXT_PUBLIC_* from .env.<env> ------
ENV_FILE=".env.$ENVIRONMENT"
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found. It must hold the $ENVIRONMENT NEXT_PUBLIC_* build values"
  echo "       (e.g. NEXT_PUBLIC_MOCK_MODE=false, NEXT_PUBLIC_CHAIN_ID, Privy/WC ids, contracts)."
  if [ "$ENVIRONMENT" = "prod" ]; then
    echo "       Start from the committed template: cp .env.prod.example .env.prod"
  fi
  exit 1
fi

# --- version tag: 2nd arg > PUSH_VERSION > IMAGE_VERSION in .env.<env> > git describe ---------
VERSION_TAG=${2:-${PUSH_VERSION:-$(env_val "$ENV_FILE" IMAGE_VERSION)}}
if [ -z "$VERSION_TAG" ]; then
  VERSION_TAG=$(git describe --tags --always 2>/dev/null || true)
fi
if [ -n "$VERSION_TAG" ]; then
  echo "  Version:   $IMAGE_NAME:$VERSION_TAG   (from IMAGE_VERSION in $ENV_FILE unless overridden)"
else
  echo "  Version:   <none> — set IMAGE_VERSION in $ENV_FILE for a rollback-able tag"
fi

# --- prod preflight: fail hard before any login or build ---------------------
if [ "$ENVIRONMENT" = "prod" ]; then
  MOCK_MODE=$(env_val "$ENV_FILE" NEXT_PUBLIC_MOCK_MODE)
  if [ "$MOCK_MODE" != "false" ]; then
    echo "Error: NEXT_PUBLIC_MOCK_MODE must be the literal 'false' in $ENV_FILE (got '${MOCK_MODE:-<unset>}')."
    echo "       Anything else ships the MOCK app to prod."
    exit 1
  fi
  APP_ENV=$(env_val "$ENV_FILE" NEXT_PUBLIC_APP_ENV)
  if [ "$APP_ENV" != "production" ]; then
    echo "Error: NEXT_PUBLIC_APP_ENV must be 'production' in $ENV_FILE (got '${APP_ENV:-<unset>}')."
    exit 1
  fi
  APP_URL=$(env_val "$ENV_FILE" NEXT_PUBLIC_APP_URL)
  if [ -z "$APP_URL" ]; then
    echo "Error: NEXT_PUBLIC_APP_URL missing from $ENV_FILE (set the prod origin, e.g. https://app.pool-party.xyz)."
    exit 1
  fi
  case "$APP_URL" in
    *dev.pool-party.xyz*)
      echo "Error: NEXT_PUBLIC_APP_URL in $ENV_FILE points at a dev host ($APP_URL)."
      exit 1
      ;;
  esac
fi

# .env.production is the build-only file the Dockerfile picks up (gitignored). It contains ONLY
# NEXT_PUBLIC_* so no server-only secret can leak into the image. Cleaned up on exit.
trap 'rm -f .env.production' EXIT
if ! grep -E '^NEXT_PUBLIC_' "$ENV_FILE" > .env.production || [ ! -s .env.production ]; then
  echo "Error: no NEXT_PUBLIC_* variables found in $ENV_FILE."
  exit 1
fi
echo "  Baking $(wc -l < .env.production | tr -d ' ') NEXT_PUBLIC_* vars from $ENV_FILE"

# --- stable Server Actions key (POO-673) -------------------------------------
# A CONSISTENT NEXT_SERVER_ACTIONS_ENCRYPTION_KEY (server-only, read from .env.<env>) is passed as a
# build-arg so Next bakes the SAME key into every build. Without it Next generates a random key per
# build and Server Action IDs rotate each deploy, breaking any slightly-stale browser tab with
# "Failed to find Server Action". Required: every deployer MUST set the same value (see .env.example).
SA_KEY=$(env_val "$ENV_FILE" NEXT_SERVER_ACTIONS_ENCRYPTION_KEY)
if [ -z "$SA_KEY" ]; then
  echo "Error: NEXT_SERVER_ACTIONS_ENCRYPTION_KEY missing from $ENV_FILE."
  echo "       It must be the shared, STABLE value (see .env.example / POO-673) so Server Action IDs"
  echo "       do not rotate across deploys. Add it to $ENV_FILE and re-run."
  exit 1
fi
# Prod must NEVER reuse the committed dev key; compared against .env.example at runtime.
if [ "$ENVIRONMENT" = "prod" ]; then
  DEV_SA_KEY=$(env_val .env.example NEXT_SERVER_ACTIONS_ENCRYPTION_KEY)
  if [ -n "$DEV_SA_KEY" ] && [ "$SA_KEY" = "$DEV_SA_KEY" ]; then
    echo "Error: NEXT_SERVER_ACTIONS_ENCRYPTION_KEY in $ENV_FILE equals the committed DEV key (.env.example)."
    echo "       Generate a prod-only key once (openssl rand -base64 32) and keep it stable forever."
    exit 1
  fi
fi

# --- ECR login ---------------------------------------------------------------
# Skipped when ~/.docker/config.json maps this registry to a credential helper (e.g.
# docker-credential-ecr-login): the helper mints a token per `docker push` from the AWS chain, so a
# login is redundant AND fatal here, because its `store` verb answers `not implemented` and
# `docker login` exits non-zero on it (which `set -e` turns into an abort).
CRED_HELPER=$(node -e 'const fs=require("fs"),os=require("os");try{const d=JSON.parse(fs.readFileSync(os.homedir()+"/.docker/config.json","utf8"));process.stdout.write((d.credHelpers||{})[process.argv[1]]||"")}catch{}' "$ECR_REGISTRY" 2>/dev/null || true)
if [ -n "$CRED_HELPER" ]; then
  echo "  Auth:      docker-credential-$CRED_HELPER handles $ECR_REGISTRY (skipping docker login)"
else
  aws ecr get-login-password --profile "$AWS_PROFILE" --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "$ECR_REGISTRY"
fi

# --- build, tag, push --------------------------------------------------------
docker build --platform "$PLATFORM" \
  --build-arg NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$SA_KEY" -t "$LOCAL_TAG" -f Dockerfile .
docker tag "$LOCAL_TAG:latest" "$IMAGE_NAME:latest"
docker push "$IMAGE_NAME:latest"
if [ -n "$VERSION_TAG" ]; then
  docker tag "$LOCAL_TAG:latest" "$IMAGE_NAME:$VERSION_TAG"
  docker push "$IMAGE_NAME:$VERSION_TAG"
fi

echo "Successfully pushed $IMAGE_NAME:latest"
if [ -n "$VERSION_TAG" ]; then
  echo "Successfully pushed $IMAGE_NAME:$VERSION_TAG"
fi
echo "Verify: each 'docker push' above must have printed a 'digest: sha256:...' line."
