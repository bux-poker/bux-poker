# 🏗️ BUX Poker - Complete Build Plan

## 📊 Current Status Review

### ✅ Completed
- **Shared Components Extracted**: Card rendering, Chat system, Socket infrastructure, Auth system, Styling
- **Server Config**: Database, Redis, Passport, Server setup, Auth middleware
- **Directory Structure**: All folders created for client, server, shared, prisma
- **Reference Templates**: package.json, tsconfig.json, tailwind.config.js templates

### 🚧 Missing / To Build
- **Project Configuration**: Actual package.json files, build configs, environment setup
- **Database Schema**: Prisma schema for tournaments, games, players, hands
- **Server Implementation**: Main entry point, services, routes, socket handlers, Discord bot
- **Client Implementation**: All React components, features, entry points, routing
- **Poker Game Logic**: Texas Hold'em engine, hand evaluator, betting rounds
- **Tournament Engine**: Multi-table management, consolidation, seat balancing
- **Integration**: Connect all pieces together

---

## 🎯 Build Phases

### Phase 1: Project Foundation & Configuration
**Goal**: Set up build system, dependencies, and basic project structure

#### 1.1 Client Setup
- [ ] Create `client/package.json` from template (rename from bux-spades-client)
- [ ] Create `client/tsconfig.json` from template
- [ ] Create `client/tailwind.config.js` from template
- [ ] Create `client/vite.config.ts` (Vite configuration)
- [ ] Create `client/index.html` (entry HTML)
- [ ] Create `client/src/main.tsx` (React entry point)
- [ ] Create `client/src/App.tsx` (main app component with routing)
- [ ] Create `client/.env.example` (environment variables template)
- [ ] Install dependencies: `cd client && npm install`

#### 1.2 Server Setup
- [ ] Create `server/package.json` from template (rename from bux-spades-server)
- [ ] Create `server/src/index.js` (main server entry point)
- [ ] Create `server/.env.example` (environment variables template)
- [ ] Update `server/src/config/server.js` (update CORS origins for poker domain)
- [ ] Install dependencies: `cd server && npm install`

#### 1.3 Root Configuration
- [ ] Create root `.gitignore`
- [ ] Create root `README.md` (update with poker-specific info)
- [ ] Create `docker-compose.yml` (optional, for local dev with DB/Redis)
- [ ] Create `.env.example` at root

---

### Phase 2: Database Schema & Models
**Goal**: Define all data models for tournaments, games, players, hands

#### 2.1 Prisma Schema
- [ ] Create `prisma/schema.prisma` with models:
  - [ ] `User` (id, discordId, username, email, avatar, createdAt, updatedAt)
  - [ ] `Tournament` (id, name, startTime, status, maxPlayers, seatsPerTable, startingChips, blindLevels, prizePlaces, createdBy, createdAt)
  - [ ] `TournamentRegistration` (id, tournamentId, userId, registeredAt, status)
  - [ ] `Game` (id, tournamentId, tableNumber, status, currentBlindLevel, pot, communityCards, createdAt, updatedAt)
  - [ ] `Player` (id, gameId, userId, seatNumber, chips, holeCards, status, lastAction, position)
  - [ ] `Hand` (id, gameId, handNumber, pot, communityCards, winnerId, handHistory, createdAt)
  - [ ] `HandAction` (id, handId, playerId, action, amount, street, timestamp)
  - [ ] `League` (id, name, month, year, status, totalGames, createdAt)
  - [ ] `LeagueGame` (id, leagueId, tournamentId, gameNumber, completedAt)
  - [ ] `LeagueStanding` (id, leagueId, userId, points, gamesPlayed, bestFinish, createdAt, updatedAt)
  - [ ] `DiscordServer` (id, serverId, serverName, announcementChannelId, enabled, createdAt)
- [ ] Run `npx prisma generate`
- [ ] Create initial migration: `npx prisma migrate dev --name init`

#### 2.2 Database Seeding (Optional)
- [ ] Create `prisma/seed.js` for initial data (admin users, test data)

---

### Phase 3: Shared Types & Utilities
**Goal**: Define TypeScript types and shared utilities for poker

#### 3.1 Poker Types
- [ ] Create `shared/types/poker.ts`:
  - [ ] Card, Suit, Rank types
  - [ ] Hand types (HighCard, Pair, TwoPair, etc.)
  - [ ] GameState, PlayerState, TournamentState
  - [ ] BettingAction types (fold, check, call, bet, raise, all-in)
  - [ ] Street types (preflop, flop, turn, river)
  - [ ] Tournament types (lobby, active, completed)

#### 3.2 Poker Utilities
- [ ] Create `shared/utils/pokerUtils.ts`:
  - [ ] Card comparison functions
  - [ ] Hand strength evaluation helpers
  - [ ] Betting validation utilities
  - [ ] Position calculation (button, small blind, big blind)

#### 3.3 Update Existing Types
- [ ] Update `shared/types/game.ts` or create poker-specific version
- [ ] Update socket types in `shared/utils/socket/socketTypes.ts` for poker events

---

### Phase 4: Server Core Implementation
**Goal**: Build backend services, routes, and socket handlers

#### 4.1 Main Server Entry
- [ ] Create `server/src/index.js`:
  - [ ] Import app, server, io from config
  - [ ] Set up database connection
  - [ ] Set up Redis connection
  - [ ] Initialize socket handlers
  - [ ] Set up API routes
  - [ ] Start server on PORT

#### 4.2 Poker Game Logic Module
- [ ] Create `server/src/modules/poker/TexasHoldem.js`:
  - [ ] Deck management (shuffle, deal)
  - [ ] Hand evaluation (best 5-card hand from 7 cards)
  - [ ] Hand comparison (winner determination)
- [ ] Create `server/src/modules/poker/HandEvaluator.js`:
  - [ ] Hand ranking logic (royal flush, straight flush, etc.)
  - [ ] Hand strength calculation
- [ ] Create `server/src/modules/poker/BettingRound.js`:
  - [ ] Betting round management
  - [ ] Action validation (bet amounts, all-in logic)
  - [ ] Pot management
  - [ ] Side pot calculation for all-ins

#### 4.3 Services
- [ ] Create `server/src/services/TournamentService.js`:
  - [ ] Tournament creation
  - [ ] Registration management
  - [ ] Tournament status updates
  - [ ] Prize distribution
- [ ] Create `server/src/services/TournamentEngine.js`:
  - [ ] Multi-table management
  - [ ] Table consolidation logic
  - [ ] Seat balancing algorithm
  - [ ] Blind level progression
- [ ] Create `server/src/services/PokerGameService.js`:
  - [ ] Game initialization
  - [ ] Hand management (deal, betting rounds, showdown)
  - [ ] Player actions (bet, raise, fold, etc.)
  - [ ] Pot distribution
- [ ] Create `server/src/services/LeagueService.js`:
  - [ ] League creation
  - [ ] Points calculation (based on finishing position)
  - [ ] Standings management
  - [ ] Leaderboard generation
- [ ] Create `server/src/services/DiscordTournamentService.js`:
  - [ ] Tournament announcement formatting
  - [ ] Registration button handling
  - [ ] Status updates to Discord

#### 4.4 API Routes
- [ ] Create `server/src/routes/auth.js` (if not using shared auth)
- [ ] Create `server/src/routes/tournaments.js`:
  - [ ] GET /api/tournaments (list tournaments)
  - [ ] GET /api/tournaments/:id (tournament details)
  - [ ] POST /api/tournaments (create - admin only)
  - [ ] POST /api/tournaments/:id/register (register for tournament)
  - [ ] GET /api/tournaments/:id/players (registered players)
- [ ] Create `server/src/routes/games.js`:
  - [ ] GET /api/games/:id (game state)
  - [ ] GET /api/games/:id/hands (hand history)
- [ ] Create `server/src/routes/leagues.js`:
  - [ ] GET /api/leagues (list leagues)
  - [ ] GET /api/leagues/:id (league details)
  - [ ] GET /api/leagues/:id/standings (leaderboard)
- [ ] Create `server/src/routes/admin.js`:
  - [ ] POST /api/admin/tournaments (create tournament)
  - [ ] POST /api/admin/leagues (create league)
  - [ ] PUT /api/admin/tournaments/:id/start (start tournament)
  - [ ] PUT /api/admin/tournaments/:id/end (end tournament)
- [ ] Create `server/src/routes/index.js` (route aggregator)

#### 4.5 Socket Handlers
- [ ] Create `server/src/modules/socket-handlers/chat/gameChatHandler.js` (if not exists)
- [ ] Create `server/src/modules/socket-handlers/poker/gameHandler.js`:
  - [ ] `join-game` - Player joins game table
  - [ ] `leave-game` - Player leaves game
  - [ ] `player-action` - Bet, raise, fold, check, call, all-in
  - [ ] `request-game-state` - Get current game state
  - [ ] `spectator-join` - Spectator joins to watch
- [ ] Create `server/src/modules/socket-handlers/tournament/tournamentHandler.js`:
  - [ ] `join-tournament-lobby` - Join tournament waiting room
  - [ ] `leave-tournament-lobby` - Leave tournament
  - [ ] `request-tournament-state` - Get tournament status
- [ ] Create `server/src/modules/socket-handlers/index.js` (handler aggregator)

#### 4.6 Discord Bot
- [ ] Create `server/src/discord/bot.js`:
  - [ ] Bot initialization
  - [ ] Multi-server support
  - [ ] Server registration/configuration
- [ ] Create `server/src/discord/commands/`:
  - [ ] `register.js` - Register server for announcements
  - [ ] `config.js` - Configure announcement channel
- [ ] Create `server/src/discord/services/AnnouncementService.js`:
  - [ ] Tournament announcement posting
  - [ ] Registration button handling
  - [ ] Tournament status updates
- [ ] Integrate Discord bot in `server/src/index.js`

---

### Phase 5: Client Core Implementation
**Goal**: Build React frontend with all features

#### 5.1 Entry Points & Routing
- [ ] Create `client/src/main.tsx`:
  - [ ] React 18 root setup
  - [ ] Router provider
  - [ ] Auth context provider
  - [ ] Socket context provider
  - [ ] Global styles import
- [ ] Create `client/src/App.tsx`:
  - [ ] React Router setup
  - [ ] Route definitions:
    - [ ] `/` - Home/Landing
    - [ ] `/login` - Login page
    - [ ] `/register` - Register page
    - [ ] `/tournaments` - Tournament list
    - [ ] `/tournaments/:id` - Tournament lobby/active view
    - [ ] `/game/:id` - Poker table view
    - [ ] `/leagues` - League list
    - [ ] `/leagues/:id` - League standings
    - [ ] `/admin` - Admin panel (protected)
    - [ ] `/spectate/:id` - Spectator mode

#### 5.2 Services Layer
- [ ] Create `client/src/services/api.ts`:
  - [ ] Axios instance with auth
  - [ ] API client functions (tournaments, games, leagues)
- [ ] Create `client/src/services/socket.ts`:
  - [ ] Socket connection setup
  - [ ] Poker-specific socket events
  - [ ] Tournament socket events
- [ ] Create `client/src/services/handHistory.ts`:
  - [ ] Hand history fetching
  - [ ] Hand replay functionality

#### 5.3 Poker Components
- [ ] Create `client/src/components/poker/PokerTable.tsx`:
  - [ ] Table layout (positions, community cards area)
  - [ ] Player seats rendering
  - [ ] Pot display
  - [ ] Betting area
- [ ] Create `client/src/components/poker/PlayerSeat.tsx`:
  - [ ] Player info display
  - [ ] Chip stack visualization
  - [ ] Hole cards (face down for others)
  - [ ] Action indicator
- [ ] Create `client/src/components/poker/CommunityCards.tsx`:
  - [ ] Flop, turn, river display
  - [ ] Card animations
- [ ] Create `client/src/components/poker/BettingUI.tsx`:
  - [ ] Action buttons (fold, check, call, bet, raise, all-in)
  - [ ] Bet amount slider/input
  - [ ] Pot odds display
- [ ] Create `client/src/components/poker/HandHistory.tsx`:
  - [ ] Previous hands list
  - [ ] Hand replay viewer

#### 5.4 Tournament Components
- [ ] Create `client/src/components/tournament/TournamentList.tsx`:
  - [ ] List of upcoming/active tournaments
  - [ ] Registration status
  - [ ] Filter/sort options
- [ ] Create `client/src/components/tournament/TournamentLobby.tsx`:
  - [ ] Tournament info display
  - [ ] Registered players list
  - [ ] Registration button
  - [ ] Countdown to start
- [ ] Create `client/src/components/tournament/TournamentActive.tsx`:
  - [ ] Tournament status (players remaining, current blind level)
  - [ ] Table assignments
  - [ ] Leaderboard
- [ ] Create `client/src/components/tournament/TournamentResults.tsx`:
  - [ ] Final standings
  - [ ] Prize distribution
  - [ ] Hand highlights

#### 5.5 League Components
- [ ] Create `client/src/components/league/LeagueList.tsx`
- [ ] Create `client/src/components/league/LeagueStandings.tsx`:
  - [ ] Leaderboard table
  - [ ] Points breakdown
  - [ ] Games played

#### 5.6 Admin Components
- [ ] Create `client/src/components/admin/AdminPanel.tsx`:
  - [ ] Admin navigation
  - [ ] Tournament creation form
  - [ ] League creation form
  - [ ] Tournament management (start/end)
- [ ] Create `client/src/components/admin/TournamentForm.tsx`:
  - [ ] Tournament name, start time
  - [ ] Max players, seats per table
  - [ ] Starting chips
  - [ ] Blind level configuration
  - [ ] Prize places
- [ ] Create `client/src/components/admin/LeagueForm.tsx`:
  - [ ] League name, month/year
  - [ ] Number of games
  - [ ] Points system configuration

#### 5.7 Shared Components (Adapt from spades)
- [ ] Adapt `shared/components/CardRenderer.tsx` for poker:
  - [ ] Support for hole cards (face down)
  - [ ] Community cards layout
- [ ] Verify `shared/components/chat/` works with poker context
- [ ] Verify `shared/features/auth/` works correctly

#### 5.8 Features
- [ ] Create `client/src/features/tournament/TournamentView.tsx`:
  - [ ] Tournament state management
  - [ ] Socket integration
  - [ ] Route to appropriate view (lobby/active/results)
- [ ] Create `client/src/features/game/PokerGameView.tsx`:
  - [ ] Game state management
  - [ ] Socket event handling
  - [ ] Player action handling
  - [ ] Game state synchronization
- [ ] Create `client/src/features/league/LeagueView.tsx`:
  - [ ] League data fetching
  - [ ] Standings display
- [ ] Create `client/src/features/spectator/SpectatorView.tsx`:
  - [ ] Read-only game view
  - [ ] Multiple table viewing
  - [ ] Hand history access

#### 5.9 Hooks
- [ ] Create `client/src/hooks/useTournament.ts`:
  - [ ] Tournament data fetching
  - [ ] Registration handling
  - [ ] Tournament state updates
- [ ] Create `client/src/hooks/usePokerGame.ts`:
  - [ ] Game state management
  - [ ] Player actions
  - [ ] Socket event handling
- [ ] Create `client/src/hooks/useLeague.ts`:
  - [ ] League data fetching
  - [ ] Standings updates

---

### Phase 6: Integration & Polish
**Goal**: Connect all pieces, add polish, handle edge cases

#### 6.1 Socket Integration
- [ ] Connect poker socket handlers to game service
- [ ] Connect tournament socket handlers to tournament engine
- [ ] Test real-time updates (player actions, game state)
- [ ] Handle reconnection logic

#### 6.2 Error Handling
- [ ] Add error boundaries in React
- [ ] Add error handling in API calls
- [ ] Add error handling in socket events
- [ ] User-friendly error messages

#### 6.3 Loading States
- [ ] Add loading indicators for API calls
- [ ] Add skeleton loaders for game/tournament views
- [ ] Add transition animations

#### 6.4 Responsive Design
- [ ] Mobile optimization for poker table
- [ ] Mobile-friendly betting UI
- [ ] Responsive tournament list
- [ ] Test on various screen sizes

#### 6.5 Spectator Mode
- [ ] Implement spectator socket events
- [ ] Create spectator UI (no betting controls)
- [ ] Multi-table spectator view
- [ ] Hand history viewer for spectators

#### 6.6 Hand History
- [ ] Store hand history in database
- [ ] Display hand history in UI
- [ ] Hand replay functionality
- [ ] Export hand history (optional)

---

### Phase 7: Testing & Quality Assurance
**Goal**: Ensure everything works correctly

#### 7.1 Unit Tests (Optional but Recommended)
- [ ] Test poker game logic (hand evaluation, betting)
- [ ] Test tournament engine (consolidation, seat balancing)
- [ ] Test utility functions

#### 7.2 Integration Testing
- [ ] Test tournament flow (create → register → start → play → end)
- [ ] Test game flow (deal → betting → showdown)
- [ ] Test socket events (player actions, state updates)
- [ ] Test Discord bot integration

#### 7.3 Manual Testing
- [ ] Test with multiple players
- [ ] Test table consolidation
- [ ] Test all-in scenarios
- [ ] Test edge cases (disconnections, timeouts)
- [ ] Test admin panel functionality
- [ ] Test league point calculation

---

### Phase 8: Deployment Preparation
**Goal**: Prepare for production deployment

#### 8.1 Environment Configuration
- [ ] Create production `.env` files
- [ ] Set up environment variables:
  - [ ] Database URL
  - [ ] Redis URL
  - [ ] Discord bot token
  - [ ] Session secret
  - [ ] CORS origins
  - [ ] API URLs

#### 8.2 Build Configuration
- [ ] Update client build script for production
- [ ] Update server build script
- [ ] Test production builds locally
- [ ] Optimize bundle sizes

#### 8.3 Database Migration
- [ ] Create production migration
- [ ] Set up database backup strategy
- [ ] Document database schema

#### 8.4 Documentation
- [ ] Update README with setup instructions
- [ ] Document API endpoints
- [ ] Document socket events
- [ ] Document deployment process
- [ ] Create admin guide

#### 8.5 Security
- [ ] Review authentication/authorization
- [ ] Review input validation
- [ ] Review rate limiting
- [ ] Review CORS configuration
- [ ] Review environment variable security

---

## 📋 Priority Order

### Must Have (MVP)
1. Phase 1: Project Foundation
2. Phase 2: Database Schema
3. Phase 3: Shared Types
4. Phase 4.1-4.3: Server Core (entry, poker logic, services)
5. Phase 4.4: API Routes (basic)
6. Phase 4.5: Socket Handlers (poker game)
7. Phase 5.1-5.3: Client Core (routing, poker components)
8. Phase 5.8: Features (tournament, game views)
9. Phase 6.1: Socket Integration

### Should Have (Full Features)
- Phase 4.6: Discord Bot
- Phase 5.4-5.6: Tournament, League, Admin components
- Phase 6.2-6.4: Error handling, loading, responsive

### Nice to Have (Polish)
- Phase 6.5-6.6: Spectator mode, hand history
- Phase 7: Testing
- Phase 8: Deployment prep

---

## 🚀 Quick Start Commands

Once Phase 1 is complete:

```bash
# Install dependencies
cd client && npm install
cd ../server && npm install

# Set up database
cd ../prisma && npx prisma generate && npx prisma migrate dev

# Start development
cd ../server && npm run dev
cd ../client && npm run dev
```

---

## 📝 Notes

- **Shared Components**: Most shared components from spades can be reused with minimal changes
- **Socket Events**: Need to define poker-specific socket events (bet, raise, fold, etc.)
- **Card Components**: Need to adapt for poker layouts (community cards, hole cards)
- **Types**: Create poker-specific types, can keep some game.ts types as reference
- **Database**: Prisma schema is critical - design carefully for tournaments, multi-table games
- **Tournament Engine**: Most complex part - table consolidation and seat balancing logic

---

## ✅ Completion Checklist

Use this to track overall progress:

- [ ] Phase 1: Project Foundation
- [ ] Phase 2: Database Schema
- [ ] Phase 3: Shared Types
- [ ] Phase 4: Server Implementation
- [ ] Phase 5: Client Implementation
- [ ] Phase 6: Integration & Polish
- [ ] Phase 7: Testing
- [ ] Phase 8: Deployment Prep

---

**Last Updated**: Review date
**Status**: Planning Phase → Ready for Implementation
