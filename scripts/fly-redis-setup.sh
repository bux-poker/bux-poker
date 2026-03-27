#!/usr/bin/env bash
# Create Fly-managed Upstash Redis (reachable from bux-poker on Fly) and wire REDIS_URL.
# Run from repo root. Requires: fly auth, same org as app "bux-poker".
#
# Step 1 must be run in YOUR terminal (interactive). Fly will ask about ProdPack — decline unless you want it ($200/mo).
set -euo pipefail
export PATH="${HOME}/.fly/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

cat <<'EOF'

=== Redis for bux-poker (Fly) ===

Your Render redis://red-xxxxx:6379 URL only works INSIDE Render. On Fly you need Fly Upstash Redis.

Do this ORDER (step 3 applies a working URL before you deploy the API build that enforces it):

1) Create the database (interactive — run this yourself, answer prompts):

     fly redis create -n bux-poker-redis -r ams --no-replicas --enable-eviction

   Region ams matches bux-poker in fly.toml. Decline ProdPack if asked.

2) Copy the Private URL:

     fly redis status bux-poker-redis

   You want: Private URL = redis://...@fly-....upstash.io

3) Set the secret (restarts the app with working Redis — test the game):

     fly secrets set REDIS_URL='PASTE_PRIVATE_URL_HERE' -a bux-poker

4) Deploy the latest API code, then verify:

     fly deploy -a bux-poker

5) Check logs:

     fly logs -a bux-poker

   You should see: [REDIS] Configured host: ... and Connected to Redis

EOF

