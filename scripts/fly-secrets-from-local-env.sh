#!/usr/bin/env bash
# Load secrets from server/.env and push them to Fly (no secrets committed to git).
# REDIS_URL must be a resolvable host from Fly (e.g. Upstash *.upstash.io, or Fly Redis).
# Do not use a hostname with no domain (ENOTFOUND) or Render-internal-only names.
#
# Usage (from repo root):
#   export REDIS_URL='rediss://default:PASSWORD@HOST.upstash.io:6379'   # full URL from provider
#   export FLY_APP_HOST='https://bux-poker.fly.dev'   # optional; must match fly.toml app name
#   ./scripts/fly-secrets-from-local-env.sh
#
set -euo pipefail
export PATH="${HOME}/.fly/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/server/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}"
  exit 1
fi

if [[ -z "${REDIS_URL:-}" ]]; then
  echo "Export REDIS_URL first (full hostname from Upstash/Fly Redis dashboard), e.g.:"
  echo "  export REDIS_URL='rediss://default:...@....upstash.io:6379'"
  exit 1
fi

# IMPORTANT: server/.env often contains an old or truncated REDIS_URL. Sourcing .env would
# overwrite the value you just exported — that is how Fly ended up with ENOTFOUND hostnames.
REDIS_URL_FROM_EXPORT="${REDIS_URL}"

# Export every VAR=value from .env for this shell only
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

export REDIS_URL="${REDIS_URL_FROM_EXPORT}"

FLY_API="${FLY_APP_HOST:-https://bux-poker.fly.dev}"
FLY_API="${FLY_API%/}"

export CLIENT_URL="${PRODUCTION_CLIENT_URL:-https://bux-poker.pro}"
export API_BASE_URL="${FLY_API}"
export DISCORD_CALLBACK_URL="${FLY_API}/api/auth/discord/callback"

cd "${ROOT}"

# NODE_ENV / PORT come from fly.toml; only set app secrets here.
fly secrets set \
  DATABASE_URL="${DATABASE_URL}" \
  REDIS_URL="${REDIS_URL}" \
  SESSION_SECRET="${SESSION_SECRET}" \
  JWT_SECRET="${JWT_SECRET}" \
  DISCORD_CLIENT_ID="${DISCORD_CLIENT_ID}" \
  DISCORD_CLIENT_SECRET="${DISCORD_CLIENT_SECRET}" \
  DISCORD_BOT_TOKEN="${DISCORD_BOT_TOKEN}" \
  CLIENT_URL="${CLIENT_URL}" \
  API_BASE_URL="${API_BASE_URL}" \
  DISCORD_CALLBACK_URL="${DISCORD_CALLBACK_URL}"

echo "Secrets set. Next: fly deploy"
