#!/usr/bin/env bash
# Load secrets from server/.env and push them to Fly (no secrets committed to git).
# REDIS_URL is not in most local .files — set it from your Render dashboard first.
#
# Usage (from repo root):
#   export REDIS_URL='redis://...'   # from Render → Redis or Upstash
#   export FLY_APP_HOST='https://bux-poker-server.fly.dev'   # optional; must match fly.toml app name
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
  echo "Export REDIS_URL first (copy from Render → your Redis add-on), e.g.:"
  echo "  export REDIS_URL='redis://...'"
  exit 1
fi

# Export every VAR=value from .env for this shell only
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

FLY_API="${FLY_APP_HOST:-https://bux-poker-server.fly.dev}"
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
