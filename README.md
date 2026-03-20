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
- Auth: Discord OAuth + Passport
- Hosting: Vercel (frontend), Railway (backend), Supabase (Postgres)

## Repository Layout

```text
bux-poker/
├── client/        # React frontend
├── server/        # Express + Socket.IO backend
├── shared/        # Shared types/components/utils
├── prisma/        # Prisma schema and migrations
└── docs/          # Supplemental docs
```

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

### Render: fetch server logs (CLI)

```bash
# List services (once logged in: render login)
render services -o json

# Recent logs for the API service (replace with your service id from JSON)
render logs -r srv-d5kbqpnfte5s73cin3q0 --limit 200 -o text

# Filter by substring
render logs -r srv-d5kbqpnfte5s73cin3q0 --limit 200 -o text --text TOURNAMENT
```

- Use a persistent backend process for websockets (Railway works well).
- Set `CLIENT_URL` correctly in backend env for CORS.
- Set `REDIS_URL` in production for Redis session storage.
- Run Prisma deploy/generate on deploy.

## Poker Rules and Engine Notes

- Texas Hold'em with preflop/flop/turn/river flow
- Blinds and dealer rotation
- Side-pot and showdown handling
- Tournament balancing and table consolidation
- Server is authoritative; clients render and reconcile from socket state

## Assets

- Card files expected at `client/public/cards/` as `{RANK}{SUIT}.png`
- Sound file expectations are documented in `client/public/sounds/README.md`
