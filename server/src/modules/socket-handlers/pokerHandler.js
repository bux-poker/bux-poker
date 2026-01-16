// Socket handler for poker table events.
// Wires Socket.IO events to PokerGameService, BettingRound and Prisma.

import { prisma } from "../../config/database.js";
import { PokerGameService } from "../../services/PokerGameService.js";
import { TexasHoldem } from "../poker/TexasHoldem.js";
import { BettingRound } from "../poker/BettingRound.js";

const gameService = new PokerGameService();
const engine = new TexasHoldem({ smallBlind: 10, bigBlind: 20 });

// In-memory per-game state for the current hand and betting street.
// For production you'd want this to be more robust / persisted.
const tableState = new Map();

// Turn timers: map of gameId -> { playerId, timeout, expiresAt }
const turnTimers = new Map();

// Test player action timeouts: map of gameId -> { playerId, timeout }
const testPlayerTimers = new Map();

// Store io instance for use by other modules
let ioInstance = null;

export function getIO() {
  return ioInstance;
}

function buildClientGameState(game, state) {
  return {
    id: game.id,
    tournamentId: game.tournamentId,
    tableNumber: game.tableNumber,
    pot: state?.pot ?? game.pot,
    communityCards: JSON.stringify(state?.communityCards ?? []),
    street: state?.street || "PREFLOP",
    currentBet: state?.bettingRound?.currentBet || 0,
    minimumRaise: state?.bettingRound?.minimumRaise || (state?.bettingRound?.bigBlind || 20),
    smallBlind: state?.bettingRound?.smallBlind || 10,
    bigBlind: state?.bettingRound?.bigBlind || 20,
    dealerSeat: state?.dealerSeat ?? game.dealerSeat,
    smallBlindSeat: state?.smallBlindSeat ?? game.smallBlindSeat,
    bigBlindSeat: state?.bigBlindSeat ?? game.bigBlindSeat,
    currentTurnUserId: state?.currentTurnUserId,
    players: (state?.players ?? game.players).map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.user?.username || "Player",
      chips: p.chips,
      seatNumber: p.seatNumber,
      status: p.status,
      avatarUrl: p.user?.avatarUrl || null,
      holeCards: p.holeCards ? JSON.parse(p.holeCards) : null,
      contribution: state?.bettingRound?.getPlayerContribution(p.id) || 0
    }))
  };
}

async function ensureHandState(gameId) {
  let state = tableState.get(gameId);
  if (state) return state;

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: {
        include: { user: true }
      }
    }
  });

  if (!game) {
    throw new Error("Game not found");
  }

  const deck = engine.createShuffledDeck();
  const { deck: remainingDeck, players: dealtHands } = engine.dealHoleCards(
    deck,
    game.players.length
  );

  // Persist hole cards to players (encoded as JSON string).
  await Promise.all(
    game.players.map((p, index) =>
      prisma.player.update({
        where: { id: p.id },
        data: {
          holeCards: JSON.stringify(dealtHands[index])
        }
      })
    )
  );

  const bettingRound = new BettingRound({
    smallBlind: engine.smallBlind,
    bigBlind: engine.bigBlind,
    startingPot: game.pot
  });

  state = {
    street: "PREFLOP",
    deck: remainingDeck,
    communityCards: [],
    bettingRound,
    pot: game.pot,
    players: game.players.map((p) => ({
      ...p,
      contributions: 0
    }))
  };

  tableState.set(gameId, state);
  return state;
}

async function applyPlayerAction({ gameId, userId, action, amount }) {
  const state = await ensureHandState(gameId);

  const player = state.players.find((p) => p.userId === userId);
  if (!player) {
    throw new Error("Player not at this table");
  }

  // Basic action handling. This is intentionally simplified:
  switch (action) {
    case "BET":
    case "RAISE": {
      state.bettingRound.bet(player.id, amount);
      player.chips -= amount;
      state.pot = state.bettingRound.getTotalPot();
      break;
    }
    case "CALL": {
      const spent = state.bettingRound.call(player.id, player.chips);
      player.chips -= spent;
      state.pot = state.bettingRound.getTotalPot();
      break;
    }
    case "CHECK": {
      // No chips moved; validity (no outstanding bet) assumed client-side for now.
      break;
    }
    case "FOLD": {
      player.status = "FOLDED";
      break;
    }
    case "ALL_IN": {
      const allInAmount = player.chips;
      if (allInAmount <= 0) {
        throw new Error("Cannot go all-in with zero chips");
      }
      state.bettingRound.bet(player.id, allInAmount);
      player.chips = 0;
      state.pot = state.bettingRound.getTotalPot();
      break;
    }
    default:
      throw new Error("Unknown action");
  }

  // Persist chips and status for this player.
  await prisma.player.update({
    where: { id: player.id },
    data: {
      chips: player.chips,
      status: player.status,
      lastAction: action
    }
  });

  // Persist pot to game.
  await prisma.game.update({
    where: { id: gameId },
    data: {
      pot: state.pot
    }
  });

  return state;
}

/**
 * Start a hand for a game with dealer assignment and blinds
 * This can be called from startTournament or when players join
 */
export async function startHandForGame(gameId, io) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: {
        include: { user: true }
      },
      tournament: true
    }
  });

  if (!game || game.players.length < 2) {
    throw new Error("Game not found or not enough players");
  }

  // Skip if hand already exists
  if (tableState.get(gameId)) {
    return;
  }

  // Get tournament blind levels
  let smallBlind = 10;
  let bigBlind = 20;
  
  if (game.tournament?.blindLevelsJson) {
    try {
      const blindLevels = JSON.parse(game.tournament.blindLevelsJson);
      if (blindLevels && blindLevels.length > 0) {
        const firstLevel = blindLevels[0];
        smallBlind = firstLevel.smallBlind || 10;
        bigBlind = firstLevel.bigBlind || 20;
      }
    } catch (e) {
      console.warn("Failed to parse blind levels, using defaults");
    }
  }

  // Create engine with tournament blind levels
  const tournamentEngine = new TexasHoldem({ 
    smallBlind, 
    bigBlind 
  });

  // Randomly assign dealer (pick random player index)
  const dealerIndex = Math.floor(Math.random() * game.players.length);
  
  // Calculate SB and BB positions (dealer + 1 = SB, dealer + 2 = BB, wrapping)
  const sbIndex = (dealerIndex + 1) % game.players.length;
  const bbIndex = (dealerIndex + 2) % game.players.length;
  
  const dealerPlayer = game.players[dealerIndex];
  const sbPlayer = game.players[sbIndex];
  const bbPlayer = game.players[bbIndex];

  // Deal hole cards
  const deck = tournamentEngine.createShuffledDeck();
  const { deck: remainingDeck, players: dealtHands } = tournamentEngine.dealHoleCards(
    deck,
    game.players.length
  );

  // Persist hole cards
  await Promise.all(
    game.players.map((p, index) =>
      prisma.player.update({
        where: { id: p.id },
        data: {
          holeCards: JSON.stringify(dealtHands[index])
        }
      })
    )
  );

  // Create betting round
  const bettingRound = new BettingRound({
    smallBlind,
    bigBlind,
    startingPot: game.pot
  });

  // Post blinds
  if (sbPlayer.chips >= smallBlind) {
    bettingRound.bet(sbPlayer.id, smallBlind);
    await prisma.player.update({
      where: { id: sbPlayer.id },
      data: { chips: sbPlayer.chips - smallBlind }
    });
  }

  if (bbPlayer.chips >= bigBlind) {
    bettingRound.bet(bbPlayer.id, bigBlind);
    await prisma.player.update({
      where: { id: bbPlayer.id },
      data: { chips: bbPlayer.chips - bigBlind }
    });
  }

  // Calculate UTG (first to act after BB)
  const utgIndex = (bbIndex + 1) % game.players.length;
  const utgPlayer = game.players[utgIndex];

  // Create hand state
  const state = {
    street: "PREFLOP",
    deck: remainingDeck,
    communityCards: [],
    bettingRound,
    pot: bettingRound.getTotalPot(),
    dealerSeat: dealerPlayer.seatNumber,
    smallBlindSeat: sbPlayer.seatNumber,
    bigBlindSeat: bbPlayer.seatNumber,
    currentTurnUserId: utgPlayer.userId, // First to act after BB (UTG)
    players: await Promise.all(
      game.players.map(async (p) => {
        const updated = await prisma.player.findUnique({ where: { id: p.id } });
        return {
          ...p,
          chips: updated?.chips || p.chips,
          contributions: (p.id === sbPlayer.id ? smallBlind : 0) + (p.id === bbPlayer.id ? bigBlind : 0)
        };
      })
    )
  };

  tableState.set(gameId, state);

  // Update game pot
  await prisma.game.update({
    where: { id: gameId },
    data: { pot: state.pot }
  });

  // Broadcast game state to all players
  if (io) {
    const payload = buildClientGameState(game, state);
    io.to(`game:${gameId}`).emit("game-state", payload);
  }

  // Start turn timer for first player to act (UTG)
  startTurnTimer(gameId, utgPlayer.userId, io);

  console.log(`[POKER] Started hand for game ${gameId}: dealer=${dealerPlayer.seatNumber}, sb=${sbPlayer.seatNumber}, bb=${bbPlayer.seatNumber}`);
  
  return state;
}

/**
 * Start a turn timer for a player (10 seconds for human, 3 seconds for test players)
 */
function startTurnTimer(gameId, userId, io) {
  // Clear existing timer for this game
  const existingTimer = turnTimers.get(gameId);
  if (existingTimer) {
    clearTimeout(existingTimer.timeout);
    turnTimers.delete(gameId);
  }

  // Get game state to check if player is test player
  const state = tableState.get(gameId);
  if (!state) return;

  const player = state.players.find((p) => p.userId === userId);
  if (!player) return;

  const isTestPlayer = player.name?.toLowerCase().startsWith('test player');

  // Test players get 3 seconds, human players get 10 seconds
  const timeoutMs = isTestPlayer ? 3000 : 10000;
  
  const expiresAt = Date.now() + timeoutMs;

  // Emit timer start event to clients
  if (io) {
    io.to(`game:${gameId}`).emit("turn-timer-start", {
      gameId,
      userId,
      expiresAt,
      duration: timeoutMs
    });
  }

  const timeout = setTimeout(async () => {
    // Timer expired - auto-fold for human players, or auto-act for test players
    if (isTestPlayer) {
      // Test player auto-action logic (3 second delay already passed)
      await handleTestPlayerAction(gameId, userId, io);
    } else {
      // Human player auto-fold
      await autoFoldPlayer(gameId, userId, io);
    }
    
    turnTimers.delete(gameId);
  }, timeoutMs);

  turnTimers.set(gameId, { timeout, expiresAt, userId });
}

/**
 * Auto-fold a player when their timer expires
 */
async function autoFoldPlayer(gameId, userId, io) {
  try {
    const state = await applyPlayerAction({
      gameId,
      userId,
      action: "FOLD",
      amount: 0
    });

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        players: {
          include: { user: true }
        }
      }
    });

    if (!game) return;

    // Move to next player
    await moveToNextPlayer(gameId, io);

    const payload = buildClientGameState(game, state);
    if (io) {
      io.to(`game:${gameId}`).emit("game-state", payload);
    }
  } catch (err) {
    console.error("[POKER] Error auto-folding player:", err);
  }
}

/**
 * Handle test player auto-action (simple logic: 30% fold, 40% call/check, 30% bet)
 */
async function handleTestPlayerAction(gameId, userId, io) {
  try {
    const state = tableState.get(gameId);
    if (!state) return;

    const player = state.players.find((p) => p.userId === userId);
    if (!player || player.status === 'FOLDED') return;

    const currentBet = state.bettingRound?.currentBet || 0;
    const bigBlind = state.bettingRound?.bigBlind || 20;
    const myChips = player.chips;
    const myContribution = state.bettingRound?.getPlayerContribution(player.id) || 0;
    const amountToCall = currentBet - myContribution;
    const canCheck = amountToCall === 0;

    // Simple random logic
    const rand = Math.random();
    
    let action, amount;
    
    if (rand < 0.3) {
      // 30% fold
      action = "FOLD";
      amount = 0;
    } else if (rand < 0.7 || canCheck) {
      // 40% call/check (or check if no bet)
      if (canCheck) {
        action = "CHECK";
        amount = 0;
      } else {
        action = "CALL";
        amount = Math.min(amountToCall, myChips);
      }
    } else {
      // 30% bet/raise (minimum raise or half pot)
      const minRaise = currentBet + (state.bettingRound?.minimumRaise || bigBlind);
      const halfPot = Math.floor((state.pot || 0) / 2);
      const betAmount = Math.max(minRaise, halfPot);
      amount = Math.min(betAmount, myChips);
      
      if (currentBet === 0) {
        action = "BET";
      } else {
        action = "RAISE";
      }
    }

    // Apply the action
    const newState = await applyPlayerAction({
      gameId,
      userId,
      action,
      amount
    });

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        players: {
          include: { user: true }
        }
      }
    });

    if (!game) return;

    // Move to next player
    await moveToNextPlayer(gameId, io);

    const payload = buildClientGameState(game, newState);
    if (io) {
      io.to(`game:${gameId}`).emit("game-state", payload);
    }
  } catch (err) {
    console.error("[POKER] Error handling test player action:", err);
  }
}

/**
 * Move to the next player to act
 */
async function moveToNextPlayer(gameId, io) {
  const state = tableState.get(gameId);
  if (!state) return;

  const activePlayers = state.players.filter((p) => p.status !== 'FOLDED');
  const currentIndex = activePlayers.findIndex((p) => p.userId === state.currentTurnUserId);
  
  if (currentIndex === -1) {
    // No current player, start with first active player
    if (activePlayers.length > 0) {
      state.currentTurnUserId = activePlayers[0].userId;
      startTurnTimer(gameId, state.currentTurnUserId, io);
    }
    return;
  }

  // Move to next active player (wrapping around)
  const nextIndex = (currentIndex + 1) % activePlayers.length;
  state.currentTurnUserId = activePlayers[nextIndex].userId;
  
  startTurnTimer(gameId, state.currentTurnUserId, io);
}

export function registerPokerHandlers(io) {
  // Store io instance for use by other modules
  ioInstance = io;
  
  io.on("connection", (socket) => {
    // eslint-disable-next-line no-console
    console.log("Poker client connected", socket.id);

    socket.on("join-table", async ({ gameId }) => {
      try {
        const game = await prisma.game.findUnique({
          where: { id: gameId },
          include: {
            players: {
              include: {
                user: true
              }
            },
            tournament: true
          }
        });

        if (!game) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

        socket.join(`game:${gameId}`);

        // Auto-start a hand if:
        // 1. No hand state exists yet
        // 2. Game is ACTIVE
        // 3. There are at least 2 players
        let state = tableState.get(gameId);
        if (!state && game.status === "ACTIVE" && game.players.length >= 2) {
          try {
            // Get the tournament's first blind level
            let smallBlind = 10;
            let bigBlind = 20;
            
            if (game.tournament?.blindLevelsJson) {
              try {
                const blindLevels = JSON.parse(game.tournament.blindLevelsJson);
                if (blindLevels && blindLevels.length > 0) {
                  const firstLevel = blindLevels[0];
                  smallBlind = firstLevel.smallBlind || 10;
                  bigBlind = firstLevel.bigBlind || 20;
                }
              } catch (e) {
                console.warn("Failed to parse blind levels, using defaults");
              }
            }

            // Create engine with tournament blind levels
            const tournamentEngine = new TexasHoldem({ 
              smallBlind, 
              bigBlind 
            });

            // Deal hole cards
            const deck = tournamentEngine.createShuffledDeck();
            const { deck: remainingDeck, players: dealtHands } = tournamentEngine.dealHoleCards(
              deck,
              game.players.length
            );

            // Persist hole cards
            await Promise.all(
              game.players.map((p, index) =>
                prisma.player.update({
                  where: { id: p.id },
                  data: {
                    holeCards: JSON.stringify(dealtHands[index])
                  }
                })
              )
            );

            // Create betting round
            const bettingRound = new BettingRound({
              smallBlind,
              bigBlind,
              startingPot: game.pot
            });

            // Set up blinds (SB and BB)
            // Dealer is the last player (position before SB, wrapping around)
            const dealerPlayer = game.players[game.players.length - 1];
            const sbPlayer = game.players[0];
            const bbPlayer = game.players[1] || game.players[0];
            
            if (sbPlayer.chips >= smallBlind) {
              bettingRound.bet(sbPlayer.id, smallBlind);
              await prisma.player.update({
                where: { id: sbPlayer.id },
                data: { chips: sbPlayer.chips - smallBlind }
              });
            }

            if (bbPlayer.chips >= bigBlind) {
              bettingRound.bet(bbPlayer.id, bigBlind);
              await prisma.player.update({
                where: { id: bbPlayer.id },
                data: { chips: bbPlayer.chips - bigBlind }
              });
            }

            // Create hand state
            state = {
              street: "PREFLOP",
              deck: remainingDeck,
              communityCards: [],
              bettingRound,
              pot: bettingRound.getTotalPot(),
              dealerSeat: dealerPlayer.seatNumber,
              smallBlindSeat: sbPlayer.seatNumber,
              bigBlindSeat: bbPlayer.seatNumber,
              players: await Promise.all(
                game.players.map(async (p) => {
                  const updated = await prisma.player.findUnique({ where: { id: p.id } });
                  return {
                    ...p,
                    chips: updated?.chips || p.chips,
                    contributions: (p.id === sbPlayer.id ? smallBlind : 0) + (p.id === bbPlayer.id ? bigBlind : 0)
                  };
                })
              )
            };

            tableState.set(gameId, state);

            // Update game pot
            await prisma.game.update({
              where: { id: gameId },
              data: { pot: state.pot }
            });

            console.log(`[POKER] Auto-started hand for game ${gameId} with ${game.players.length} players`);
          } catch (handError) {
            console.error("[POKER] Error auto-starting hand:", handError);
            // Continue without state if hand creation fails
          }
        }

        const payload = buildClientGameState(game, state);

        socket.emit("game-state", payload);
        
        // Broadcast to all players in the room if we just started a hand
        // (socket.server is the io instance)
        if (state) {
          socket.server.to(`game:${gameId}`).emit("game-state", payload);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("join-table error", err);
        socket.emit("error", { message: "Failed to join table" });
      }
    });

    socket.on("player-action", async ({ gameId, userId, action, amount }) => {
      try {
        // Clear turn timer for this game
        const existingTimer = turnTimers.get(gameId);
        if (existingTimer) {
          clearTimeout(existingTimer.timeout);
          turnTimers.delete(gameId);
        }

        const state = await applyPlayerAction({
          gameId,
          userId,
          action,
          amount: Number(amount) || 0
        });

        const game = await prisma.game.findUnique({
          where: { id: gameId },
          include: {
            players: {
              include: {
                user: true
              }
            }
          }
        });

        if (!game) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

        // Move to next player
        await moveToNextPlayer(gameId, io);

        const payload = buildClientGameState(game, state);

        io.to(`game:${gameId}`).emit("game-state", payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("player-action error", err);
        socket.emit("error", { message: err.message || "Action failed" });
      }
    });

    socket.on("game_message", async ({ gameId, message }) => {
      try {
        // Broadcast message to all players in the game
        io.to(`game:${gameId}`).emit("game_message", { gameId, message });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("game_message error", err);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    socket.on("disconnect", () => {
      // eslint-disable-next-line no-console
      console.log("Poker client disconnected", socket.id);
    });
  });
}


