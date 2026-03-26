#!/usr/bin/env bash
# Full Fly.io setup: auth check → app → secrets from server/.env → deploy
# Run in Terminal.app (not Cursor):  ./scripts/fly-setup.sh
set -euo pipefail
export PATH="${HOME}/.fly/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

echo "==> Fly CLI"
if ! command -v fly >/dev/null 2>&1; then
  echo "Install: curl -L https://fly.io/install.sh | sh"
  echo "Then re-run this script."
  exit 1
fi

echo "==> Login (browser will open if needed)"
fly auth whoami 2>/dev/null || fly auth login

echo "==> App (ignore error if it already exists)"
fly apps create bux-poker 2>/dev/null || true

if [[ -z "${REDIS_URL:-}" ]]; then
  set -a
  # shellcheck disable=SC1090
  [[ -f "${ROOT}/server/.env" ]] && source "${ROOT}/server/.env"
  set +a
fi
if [[ -z "${REDIS_URL:-}" ]]; then
  echo "REDIS_URL missing. Add it to server/.env or run: export REDIS_URL='redis://...'"
  exit 1
fi

echo "==> Secrets (from server/.env + production URLs)"
"${ROOT}/scripts/fly-secrets-from-local-env.sh"

echo "==> Deploy"
fly deploy

echo "==> Done. Next: Vercel → VITE_API_BASE_URL + VITE_SOCKET_URL = https://bux-poker.fly.dev"
