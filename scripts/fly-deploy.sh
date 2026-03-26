#!/usr/bin/env bash
# Run from your machine (not Cursor sandbox): deploy API to Fly.io.
# Usage: ./scripts/fly-deploy.sh
# Before first deploy: fly auth login
# Then set secrets (copy from Render dashboard), e.g.:
#   fly secrets set DATABASE_URL="..." REDIS_URL="..." SESSION_SECRET="..." JWT_SECRET="..." \
#     DISCORD_CLIENT_ID="..." DISCORD_CLIENT_SECRET="..." DISCORD_BOT_TOKEN="..." \
#     CLIENT_URL="https://bux-poker.pro" API_BASE_URL="https://bux-poker.fly.dev"

set -euo pipefail
export PATH="${HOME}/.fly/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v fly >/dev/null 2>&1; then
  echo "Install flyctl: https://fly.io/docs/hands-on/install-flyctl/"
  exit 1
fi

fly auth whoami

# Safe if app already exists
fly apps create bux-poker 2>/dev/null || true

fly deploy

echo "Done. Set Vercel VITE_API_BASE_URL and VITE_SOCKET_URL to your Fly URL, then redeploy the client."
