# BUX Poker Platform

Poker tournament platform for bux-poker.pro - Texas Hold'em tournaments with Discord bot integration and league system.

## Structure

```
bux-poker/
├── client/              # React/TypeScript frontend
│   └── src/
│       ├── components/
│       │   ├── shared/      # Extracted from spades: Cards, Chat, Socket
│       │   ├── poker/       # Poker-specific: Table, Hand, Betting UI
│       │   ├── tournament/  # Tournament lobby, active view, results
│       │   └── admin/      # Tournament + League creation panel
│       ├── features/
│       │   ├── tournament/  # Tournament views and logic
│       │   ├── league/      # League standings, leaderboard
│       │   ├── game/        # Poker table gameplay
│       │   └── spectator/   # Spectator mode
│       └── services/        # API clients, socket, hand history
│
├── server/             # Node.js/Express backend
│   └── src/
│       ├── discord/    # Multi-server Discord bot
│       │   ├── bot.js
│       │   ├── commands/
│       │   └── services/  # Announcement service
│       ├── services/
│       │   ├── TournamentService.js      # Tournament management
│       │   ├── TournamentEngine.js       # Multi-table consolidation
│       │   ├── LeagueService.js          # League points, standings
│       │   ├── PokerGameService.js       # Individual table gameplay
│       │   └── DiscordTournamentService.js
│       ├── modules/
│       │   └── poker/  # Texas Hold'em game logic
│       │       ├── TexasHoldem.js
│       │       ├── HandEvaluator.js
│       │       └── BettingRound.js
│       └── routes/
│
├── shared/             # Code extracted from spades
│   ├── components/     # Reusable UI components
│   ├── utils/          # Shared utilities
│   └── types/          # Shared TypeScript types
│
└── prisma/             # Database schema
```

## Features

### Tournaments
- Multi-table Texas Hold'em tournaments
- Configurable: seats per table, starting chips, blind levels, prize places
- Free entry (buy-ins with SPL tokens later)
- Manual prize distribution (auto payouts later)
- Table consolidation and seat balancing as players eliminate
- Real-time gameplay with spectator mode
- Hand history

### Discord Bot
- Single bot, multiple servers
- Tournament announcements in designated channels
- Registration via Discord join button
- Tournament creation via site admin panel only

### Poker League
- Monthly league with set number of games
- Points based on finishing positions
- Leaderboard with prizes after all games

## Reusable Components from Spades

- Card components (visual cards)
- Chat system (Socket.io integration)
- Socket infrastructure
- Auth system
- Table/UI styling
- Admin panel structure

## Build Phases

1. **Foundation**: Extract shared components, set up structure
2. **Discord Bot**: Multi-server bot with tournament announcements
3. **Tournament System**: Admin panel, registration, tournament engine
4. **Poker Gameplay**: Texas Hold'em logic, betting, table management
5. **League System**: Points tracking, leaderboard
6. **Polish**: Spectator mode, hand history, results

## Deployment

### Architecture
- **Frontend**: Vercel (from `client/` directory)
- **Backend**: Railway (from `server/` directory)
- **Database**: Supabase Postgres (via Prisma)

### Quick Start
1. See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for complete deployment guide
2. See **[RAILWAY_QUICK_START.md](./RAILWAY_QUICK_START.md)** for Railway-specific setup
3. See **[BUILD_PLAN.md](./BUILD_PLAN.md)** for development roadmap

### Local Development

```bash
# Install dependencies
cd client && npm install
cd ../server && npm install

# Set up environment variables
# Copy .env.example files and fill in values

# Set up database (Supabase)
# Get DATABASE_URL from Supabase dashboard
cd ../prisma
npx prisma generate
npx prisma migrate dev --name init

# Start development servers
cd ../server && npm run dev  # Backend on :3000
cd ../client && npm run dev  # Frontend on :5173
```
