# 🎮 BUX Poker Platform

A full-stack Texas Hold'em poker tournament platform with real-time multiplayer gameplay, Discord bot integration, and league system.

## ✨ Features

### 🏆 Tournaments
- **Multi-table Texas Hold'em tournaments** with automatic table consolidation
- **Configurable settings**: seats per table, starting chips, blind levels, prize distribution
- **Real-time gameplay** with Socket.IO integration
- **Automatic seat balancing** to ensure fair distribution across tables
- **Blind level progression** based on elapsed time
- **2-minute countdown** before tournament starts with Discord notifications
- **Prize places** automatically calculated (1 place per 4 registered players)

### 🤖 Discord Bot
- **Multi-server support**: Single bot manages tournaments across multiple Discord servers
- **Tournament announcements** in designated channels
- **Registration via Discord** - Players can register directly from Discord embeds
- **Game starting notifications** - Announces when tournaments are about to start
- **Tournament status updates** - Real-time updates on registration, seating, and running status

### 🎯 Poker Game Features
- **Full Texas Hold'em gameplay** with proper hand evaluation
- **Side pot calculation** for all-in scenarios
- **Proper betting rounds**: Pre-flop, Flop, Turn, River
- **Player actions**: Bet, Raise, Call, Check, Fold, All-in
- **Dealer rotation** with heads-up blind rules
- **Player elimination** handling
- **Showdown mechanics** with hand comparison
- **Action overlays** showing player actions on avatars
- **Turn timers** with automatic action for test players

### 🎨 User Interface
- **Responsive design** - Optimized for landscape mobile screens (351-1000px width)
- **Real-time updates** - Live game state synchronization
- **Action overlays** - Visual feedback for player actions
- **Countdown timers** - Tournament start countdown and turn timers
- **Chat integration** - In-game chat with dealer messages
- **Fullscreen support** - Immersive gameplay experience

### 🛠️ Technical Features
- **Type-safe codebase** - TypeScript for frontend, JSDoc for backend
- **Real-time synchronization** - Socket.IO for game state updates
- **Database persistence** - Prisma ORM with PostgreSQL
- **Authentication** - Discord OAuth integration
- **Session management** - Redis for session storage
- **Scalable architecture** - Separation of concerns with modular services

## 🏗️ Architecture

```
bux-poker/
├── client/              # React/TypeScript frontend (Vite)
│   ├── src/
│   │   ├── components/  # React components (poker, tournament, admin)
│   │   ├── features/    # Feature modules (game, tournament views)
│   │   ├── hooks/       # Custom React hooks
│   │   ├── services/    # API clients and socket management
│   │   └── pages/       # Page components
│   └── public/          # Static assets (card images, sounds)
│
├── server/              # Node.js/Express backend
│   ├── src/
│   │   ├── config/      # Database, Redis, Passport configuration
│   │   ├── discord/     # Discord bot integration
│   │   ├── middleware/  # Authentication middleware
│   │   ├── modules/     # Poker game logic (HandEvaluator, BettingRound)
│   │   ├── routes/      # API routes (admin, auth, tournaments)
│   │   ├── services/    # Business logic (TournamentEngine, PokerGameService)
│   │   └── socket-handlers/  # Socket.IO event handlers
│
├── shared/              # Shared code between client and server
│   ├── components/      # Reusable React components (Chat, CardRenderer)
│   ├── features/        # Shared features (Auth)
│   ├── styles/          # CSS files (responsive design)
│   ├── types/           # TypeScript type definitions
│   └── utils/           # Utility functions
│
└── prisma/              # Database schema and migrations
    ├── schema.prisma    # Database models
    └── migrations/      # Database migration history
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- PostgreSQL database (Supabase recommended)
- Redis (for session storage)
- Discord Bot Token and Client ID

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd bux-poker

# Install client dependencies
cd client
npm install

# Install server dependencies
cd ../server
npm install

# Install shared dependencies (if needed)
cd ../shared
npm install
```

### Environment Setup

#### Client (.env)
```env
VITE_API_URL=http://localhost:3000
VITE_DISCORD_CLIENT_ID=your_discord_client_id
VITE_DISCORD_REDIRECT_URI=http://localhost:5173/auth/callback
```

#### Server (.env)
```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Redis
REDIS_URL=redis://localhost:6379

# Server
PORT=3000
CLIENT_URL=http://localhost:5173
NODE_ENV=development

# Discord
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback

# Session
SESSION_SECRET=your_session_secret
```

### Database Setup

```bash
# Generate Prisma Client
cd prisma
npx prisma generate

# Run migrations
npx prisma migrate dev

# (Optional) Seed database
npx prisma db seed
```

### Running the Application

```bash
# Start server (from server directory)
cd server
npm run dev

# Start client (from client directory)
cd client
npm run dev
```

The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000

## 📚 Documentation

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete deployment guide
- **[RAILWAY_QUICK_START.md](./RAILWAY_QUICK_START.md)** - Railway-specific setup
- **[DISCORD_BOT_SETUP.md](./DISCORD_BOT_SETUP.md)** - Discord bot configuration
- **[DISCORD_REDIRECT_SETUP.md](./DISCORD_REDIRECT_SETUP.md)** - Discord OAuth setup
- **[DOMAIN_SETUP.md](./DOMAIN_SETUP.md)** - Domain configuration
- **[POKER_RULES_CHECKLIST.md](./POKER_RULES_CHECKLIST.md)** - Poker rules implementation
- **[PLAYER_ACTION_FLOW.md](./PLAYER_ACTION_FLOW.md)** - Player action flow documentation

## 🎮 Game Rules

The platform implements standard Texas Hold'em poker rules:

- **Blinds**: Small blind and big blind posted before each hand
- **Betting Rounds**: Pre-flop, Flop, Turn, River
- **Hand Rankings**: Standard poker hand rankings
- **All-in Handling**: Proper side pot calculation for multiple all-ins
- **Showdown**: Automatic showdown when betting round completes
- **Heads-up Rules**: Special blind posting rules for 2-player games

See [POKER_RULES_CHECKLIST.md](./POKER_RULES_CHECKLIST.md) for complete rule implementation details.

## 🛠️ Technology Stack

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Utility-first CSS framework
- **Socket.IO Client** - Real-time communication
- **React Router** - Client-side routing
- **Axios** - HTTP client

### Backend
- **Node.js** - Runtime environment
- **Express** - Web framework
- **Socket.IO** - Real-time bidirectional communication
- **Prisma** - Database ORM
- **PostgreSQL** - Database
- **Redis** - Session storage
- **Passport.js** - Authentication middleware
- **Discord.js** - Discord bot library

### Infrastructure
- **Vercel** - Frontend hosting
- **Railway** - Backend hosting
- **Supabase** - PostgreSQL database
- **Redis Cloud** - Redis hosting

## 📝 Development

### Code Structure
- **Modular design** - Clear separation of concerns
- **Type safety** - TypeScript on frontend, JSDoc on backend
- **Error handling** - Comprehensive error handling and logging
- **Real-time updates** - Socket.IO for live game state

### Key Services
- **TournamentEngine** - Manages tournament lifecycle, table consolidation, seat balancing
- **PokerGameService** - Handles individual game/table logic
- **TournamentService** - Tournament CRUD operations
- **PokerHandler** - Socket.IO handlers for game actions
- **Discord Bot** - Tournament announcements and registration

### Testing
Currently manual testing with test players. Automated testing can be added:
- Unit tests for game logic (hand evaluation, betting rounds)
- Integration tests for tournament flow
- E2E tests for player actions

## 📄 License

[Add your license here]

## 🤝 Contributing

[Add contribution guidelines here]

## 📧 Support

For issues and questions, please open an issue on the repository.
