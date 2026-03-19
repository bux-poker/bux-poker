# Real-Time / AAA-Level Upgrade Summary

This document summarizes the upgrades made so the poker app feels like a real-time game: low latency, synced state, instant feedback, and smooth assets.

## What Was Done

### 1. **Card image preloading** (`client/src/utils/cardPreloader.ts`)
- All 52 card images are preloaded when you enter a game (`/game/:id`).
- Call `preloadCards()` on mount; use `whenCardsReady()` if you need to wait before rendering cards.
- **You need card assets**: add PNGs to `client/public/cards/` (e.g. `AS.png`, `2H.png`, …, `2C.png`). See existing `getCardImage` in `PokerTable.tsx` for the naming (rank + suit letter: S, H, D, C).

### 2. **Sound unlock on first interaction**
- `soundManager.unlock()` is called on first pointer down in the game area so browser autoplay policy allows sounds (e.g. “your turn”, dealer sounds) without a prior click.
- Sounds are already preloaded in `SoundManager`; `play()` also calls `unlock()` so the first button click unlocks audio.

### 3. **Optimistic UI** (game view)
- On Fold / Check / Call / Bet / Raise, the client applies an **optimistic** state update immediately (your status, pot, contribution, and clearing “your turn”).
- Server remains source of truth; the next `game-state` socket event replaces this with the authoritative state.
- Result: buttons and table update instantly, then stay in sync when the server responds.

### 4. **Framer Motion** (card animations)
- `framer-motion` is added as a dependency.
- Card images in `PokerTable` use `motion.img` with a short scale/opacity animation (0.15s) when cards appear.
- Run `npm install` in `client/` if you haven’t so `framer-motion` is installed.

### 5. **Redis session store** (server)
- When `REDIS_URL` is set, the server uses **Redis** for express-session storage (`connect-redis`).
- Sessions survive restarts and work across multiple server instances.
- **Requires**: `connect-redis` v9 for the `redis` (node) v5 client. Install with:
  ```bash
  cd server && npm install connect-redis@9
  ```
- Startup: `index.js` awaits `connectRedis()` before `server.listen()` when `REDIS_URL` is set. If Redis is unavailable, the server falls back to in-memory sessions and logs a warning.

## Already in Place (No Changes)

- **Socket.IO** for real-time game state (no REST in the critical loop).
- **In-memory game state** on the server (`tableState` Map); Postgres is used for persistence/history, not live gameplay.
- **Persistent Node server** (e.g. Railway) for WebSockets.

## Optional Next Steps (AAA polish)

- **Zustand**: Add a small store for game state if you want even faster local updates and less prop drilling.
- **Redis adapter for Socket.IO**: If you run multiple game server instances, use `@socket.io/redis-adapter` so rooms and emits work across nodes.
- **Sticky sessions**: On a platform that scales horizontally, enable sticky sessions so the same client stays on the same server (better for WebSockets).
- **Hosting**: Fly.io, Railway, or DigitalOcean are good fits for always-on, low-latency game servers.

## Quick checklist

- [ ] Add card PNGs to `client/public/cards/` (52 files).
- [ ] In `client/`: `npm install` (for framer-motion).
- [ ] In `server/`: `npm install connect-redis@9` if you use Redis for sessions.
- [ ] Set `REDIS_URL` in production if you want Redis-backed sessions.
