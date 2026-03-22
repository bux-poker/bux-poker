# BUX Poker Platform

Real-time Texas Hold'em tournament platform using React, Socket.IO, Node.js, Prisma, and PostgreSQL.

## Current AAA Upgrade Status

Implemented:
- Real-time gameplay over Socket.IO
- In-memory game loop state on server (`tableState`) with DB persistence
- Card preloading support (`client/src/utils/cardPreloader.ts`)
- Sound unlock on first interaction (`soundManager.unlock()`)
- Optimistic client actions in `PokerGameView`
- Card entry animation via Framer Motion
- Redis-backed session store when `REDIS_URL` is set

Still needed for full polish:
- Add 52 card images to `client/public/cards/` (`AS.png` ... `2C.png`)
- Ensure production `REDIS_URL` is configured
- Optional scale item: add Socket.IO Redis adapter for multi-instance deployments

## Stack

- Frontend: React 18, TypeScript, Vite, Tailwind, Socket.IO Client
- Backend: Node.js, Express, Socket.IO, Prisma
- Data: PostgreSQL (persistent), Redis (session store)
- Auth: Discord OAuth (Vercel serverless token exchange in prod; Passport on API server for local/dev fallback)
- Hosting: Vercel (frontend), Railway (backend), Supabase (Postgres)

## Repository Layout

```text
bux-poker/
├── client/        # React frontend
├── server/        # Express + Socket.IO backend
├── shared/        # Shared types/components/utils
├── prisma/        # Prisma schema and migrations
└── docs/          # Supplemental docs (see docs/MODULE_MAP.md)
```

## Modular stack map (troubleshooting)

Authoritative detail and refactor queue: **`docs/MODULE_MAP.md`**.

### Client (`client/src`)

| Area | Role |
|------|------|
| `features/game/PokerGameView.tsx` | Table route: socket wiring, optimistic actions, tournament modals |
| `features/game/pokerGameViewTypes.ts` + `parseCommunityCards.ts` + `handBlocksConsolidationWaitOverlay.ts` | Game-state types & consolidation-overlay guard |
| `components/poker/PokerTable.tsx` | Felt, seats, cards, pot, motion (shell) |
| `components/poker/table/*` | `BetChip`, `PokerCardImage`, seat action overlays hook, constants, props types |
| `components/poker/BettingControls.tsx` | Raise/call/fold UI + sizing math |
| `components/tournament/*` | Lobby, list, modals, timestamps |
| `services/socket.ts`, `services/api.ts` | Transport |
| `hooks/*` | Tournaments, admin, layout |
| `utils/soundManager.ts`, `utils/cardPreloader.ts` | Assets / UX |

**Largest files (split first):** `PokerGameView.tsx`, `PokerTable.tsx`, `TournamentLobby.tsx` (see MODULE_MAP).

### Server (`server/src`)

| Area | Role |
|------|------|
| `modules/poker/*` | Hand engine: `actions`, `startHand`, `advanceStreet`, `turnOrder`, `showdown`, `BettingRound`, `tableState` |
| `modules/socket-handlers/*` | Socket entry: `pokerHandler`, `playerAction`, `joinTable`, … |
| `services/tournament/*` | Consolidation, busts, blinds, idle poll, chip audit |
| `services/TournamentEngine.js` | Orchestrates tournament lifecycle |
| `routes/*`, `middleware/*` | HTTP API |
| `discord/bot.js` | Discord integration |

**Largest files (split first):** `discord/bot.js`, `routes/admin.js`, `showdown.js`, `startHand.js`, `advanceStreet.js`, `testPlayers.js`, `turnOrder.js`.

### Shared (`shared/`)

Types (`types/poker`, `types/game`), auth context, chat UI, `handEvaluator` — **single source** for client + Vite aliases; keep server eval logic consistent with shared rules.

### Known overlap / conflict hotspots

- **In-memory `hasActiveHand` vs DB `game.pot`** during tournament consolidation — both guards matter.
- **Tournament end:** `completeIfOneLeft.js` and `busts.js` (chip audit / reconcile).
- **Hand cleanup:** `safeHandCleanupDb.js` + `handCleanup.js` + street/showdown paths (never resurrect `ELIMINATED`).
- **Evaluators:** shared utils vs `server/.../HandEvaluator.js` — verify parity when changing rules.

## Local Setup

### Prerequisites
- Node.js 18+
- PostgreSQL
- Redis (recommended)

### Install dependencies

```bash
cd client && npm install
cd ../server && npm install
```

### Environment variables

`client/.env`:
```env
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
VITE_DISCORD_CLIENT_ID=your_discord_client_id
VITE_DISCORD_REDIRECT_URI=http://localhost:5173/auth/callback
```

`server/.env`:
```env
DATABASE_URL=postgresql://user:password@host:5432/database
PORT=3000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
SESSION_SECRET=replace_me
REDIS_URL=redis://localhost:6379

DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_CALLBACK_URL=http://localhost:3000/api/auth/discord/callback
DISCORD_BOT_TOKEN=...
JWT_SECRET=replace_me
```

### Database

```bash
cd server
npx prisma migrate deploy --schema=../prisma/schema.prisma
npx prisma generate --schema=../prisma/schema.prisma
```

### Run locally

```bash
cd server && npm run dev
cd client && npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

## Deployment Notes

### Discord OAuth on Vercel (production)

Login starts at **`https://<your-site>/api/auth/discord`** (Vercel **serverless** in `client/api/`). The **authorization code is exchanged on Vercel’s network**, which avoids Discord / Cloudflare **blocking Render’s egress IP** on `oauth2/token`. Render still runs the game API + Socket.IO; **`JWT_SECRET` must be identical** on Vercel and Render so tokens issued by Vercel validate on the API.

**Vercel → Environment variables**

| Variable | Purpose |
|----------|---------|
| `DISCORD_CLIENT_ID` | Same as Render |
| `DISCORD_CLIENT_SECRET` | Same as Render |
| `JWT_SECRET` | **Same value as Render** (required) |
| `DATABASE_URL` | Same Postgres; prefer **pooler** URL for short-lived functions |
| `CLIENT_URL` | Canonical site for post-login redirect, e.g. `https://www.bux-poker.pro` |
| `DISCORD_VERCEL_CALLBACK_URL` | Optional. If set, must match Discord portal **exactly** (overrides Host-based callback URL). |
| `DISCORD_API_USER_AGENT` | Optional override for Discord API requests |

**Discord Developer Portal → OAuth2 → Redirects** — add every URL you use:

- `https://www.bux-poker.pro/api/auth/discord/callback` (production custom domain)
- `https://<project>.vercel.app/api/auth/discord/callback` (preview deploys, if you test login there)

The app builds `redirect_uri` from the request **Host** when `DISCORD_VERCEL_CALLBACK_URL` is unset, so **www vs apex** must match what users open and what you whitelist in Discord.

**Rollback** to Render-only OAuth (not recommended if Render IP is blocked): set **`VITE_FORCE_RENDER_DISCORD_OAUTH=true`** and **`VITE_DISCORD_LOGIN_BASE_URL`** to your API origin, e.g. `https://bux-poker-server.onrender.com`.

**Do not** set `VITE_DISCORD_LOGIN_BASE_URL` to Render unless you intend Render OAuth — if that var is set on Vercel without the force flag, older builds used it first and kept sending users to the blocked Render token exchange. Current client always prefers **same-origin** on `bux-poker.pro` / `www` / matching `*.vercel.app`.

**Local dev** still uses the Vite proxy: `/api/auth/discord` → Express on port 3000.

### Link previews: founder Discord bot page

Discord **does not run** the React app and **caches embeds aggressively**. Rewritten routes can still be associated with the SPA shell for previews.

**Share in Discord (DMs / announcements):**  
`https://www.bux-poker.pro/discord-founders.html`  

That path is a **real static file** in `client/public/discord-founders.html` (copied to `dist/`). Vercel serves it **before** the SPA fallback, so crawlers never receive `index.html`. It links humans to `/discord-bot` for the full in-app setup page.

**Also:** `/discord-bot` → `bot-invite.html` (React shell), `/bot-invite` → 308 → `/discord-bot`. Debug OG with [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/).

### Render: fetch server logs (CLI)

**Access model:** Run `render login` once on the machine where you run CLI (or where Cursor’s terminal runs). Then agents **can** pull logs with the commands below from that authenticated shell. If the CLI isn’t logged in, use **Render Dashboard → your web service → Logs**, or paste lines here. For consolidation bugs, filter `--text TOURNAMENT`. Common lines: `No free seat` = keep table was **9/9 DB rows** with several **ELIMINATED** still holding seats (fixed by pre-merge evac); `P2002` = seat collision; `Idle-poll consolidation failed` includes Prisma `code`/`meta` after recent server builds.

```bash
# List services (once logged in: render login)
render services -o json

# Recent logs for the API service (replace with your service id from JSON)
render logs -r srv-d5kbqpnfte5s73cin3q0 --limit 200 -o text

# Filter by substring
render logs -r srv-d5kbqpnfte5s73cin3q0 --limit 200 -o text --text TOURNAMENT

# Discord OAuth / token exchange
render logs -r srv-d5kbqpnfte5s73cin3q0 --limit 100 -o text --text "[AUTH]"

# Turn / betting order debugging (engine emits these prefixes)
render logs -r srv-d5kbqpnfte5s73cin3q0 --limit 500 -o text --text "[BETTING]"
render logs -r srv-d5kbqpnfte5s73cin3q0 --limit 500 -o text --text "[TURN ORDER]"
render logs -r srv-d5kbqpnfte5s73cin3q0 --limit 200 -o text --text "player-action"
```

If **`[AUTH]`** logs show **`429`** / **`1015`** on the token step, Discord is **rate-limiting or blocking** outbound requests from Render’s IP — not a wrong secret or redirect URI. The server **retries** token exchange and `users/@me` with backoff (and `Retry-After` when present). If login still fails: wait 15–30+ minutes, **Manual Deploy** on Render (egress IP may change), avoid rapid repeated “Login with Discord” clicks. Successful logins show **`[AUTH] Successfully authenticated user:`**.

- Use a persistent backend process for websockets (Railway works well).
- Set `CLIENT_URL` correctly in backend env for CORS. **Vercel previews** (`https://…bux-poker….vercel.app`) are **allowed automatically** (hostname ends with `.vercel.app` and contains `bux-poker`). To disable that, set **`CORS_STRICT_VERCEL=true`**. You can still add one-off origins with **`CORS_EXTRA_ORIGINS`** (comma-separated).
- **Discord OAuth redirect:** In the Discord Developer Portal, the redirect URL must match **`DISCORD_CALLBACK_URL`** on Render exactly. Either use **`https://<your-api-host>/api/auth/discord/callback`** (recommended) or **`https://<your-api-host>/callback`** — the server redirects `/callback` to the real handler so login is not stuck after “Authorize”.
- **Discord / Cloudflare HTML 429:** If logs show HTML (`<!doctype`) on token exchange, the host egress IP is often blocked. The server sends a proper **`User-Agent`** (override with **`DISCORD_API_USER_AGENT`** if needed). **Manual Deploy** on Render may change IP; otherwise wait or move API egress.
- Set `REDIS_URL` in production for Redis session storage.
- **Migrations must be in Git** — `prisma/migrations/` is tracked so Render’s `prisma migrate deploy` (see `server/package.json` `prestart` / `postinstall`) applies the same schema as the generated client. If you see `PrismaClientKnownRequestError` / `Invalid prisma.tournament.findUnique()` and blinds never advance, the DB is missing columns: check deploy logs for migration failures, or run `npx prisma migrate deploy --schema=prisma/schema.prisma` against production `DATABASE_URL` once.
- **P3009 failed migration on deploy**: **`docs/PRISMA_MIGRATION_RECOVERY.md`** — fix prod DB with `migrate resolve` + `migrate deploy` locally, **then** **Render → Manual Deploy** (the CLI does **not** trigger Render).

## Poker Rules and Engine Notes

- Texas Hold'em with preflop/flop/turn/river flow
- Blinds and dealer rotation
- Side-pot and showdown handling
- Tournament balancing and table consolidation
- Server is authoritative; clients render and reconcile from socket state

## Assets

- Card files expected at `client/public/cards/` as `{RANK}{SUIT}.png`
- Sound file expectations are documented in `client/public/sounds/README.md`
