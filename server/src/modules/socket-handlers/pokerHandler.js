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
      holeCards: (() => {
        if (!p.holeCards) return null;
        // If already an object, return as-is
        if (typeof p.holeCards === 'object') return p.holeCards;
        // If it's a string, try to parse it
        if (typeof p.holeCards === 'string') {
          try {
            return JSON.parse(p.holeCards);
          } catch (e) {
            console.warn(`[POKER] Failed to parse holeCards for player ${p.id}:`, e.message);
            return null;
          }
        }
        return null;
      })(),
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
      // Clear hole cards when player folds (hide them from view)
      player.holeCards = [];
      // Also clear in database
      await prisma.player.update({
        where: { id: player.id },
        data: { holeCards: "" }
      });
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

  // Randomly assign dealer (pick random player)
  const dealerIndex = Math.floor(Math.random() * game.players.length);
  const dealerPlayer = game.players[dealerIndex];
  
  // Seats are numbered anticlockwise, but blinds move clockwise (to the left)
  // So we need to decrease seat numbers (wrapping around) to move clockwise
  const dealerSeat = dealerPlayer.seatNumber;
  const maxSeat = game.players.length;
  
  // Calculate SB and BB seat numbers (clockwise = decreasing seat numbers, wrapping)
  const sbSeat = dealerSeat - 1 <= 0 ? maxSeat : dealerSeat - 1;
  const bbSeat = dealerSeat - 2 <= 0 ? (maxSeat + dealerSeat - 2) : dealerSeat - 2;
  
  // Find players at those seat numbers
  const sbPlayer = game.players.find(p => p.seatNumber === sbSeat);
  const bbPlayer = game.players.find(p => p.seatNumber === bbSeat);
  
  if (!sbPlayer || !bbPlayer) {
    throw new Error(`Could not find SB or BB players. Dealer seat: ${dealerSeat}, SB seat: ${sbSeat}, BB seat: ${bbSeat}`);
  }

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

  // Post blinds using postBlinds method (doesn't require minimum raise validation)
  if (sbPlayer.chips >= smallBlind && bbPlayer.chips >= bigBlind) {
    bettingRound.postBlinds(sbPlayer.id, bbPlayer.id);
    
    // Deduct chips from players in database
    await prisma.player.update({
      where: { id: sbPlayer.id },
      data: { chips: sbPlayer.chips - smallBlind }
    });
    
    await prisma.player.update({
      where: { id: bbPlayer.id },
      data: { chips: bbPlayer.chips - bigBlind }
    });
    
    // Update chips in memory for state
    sbPlayer.chips -= smallBlind;
    bbPlayer.chips -= bigBlind;
  }

  // Calculate UTG (first to act after BB) - continue clockwise (decreasing seat numbers)
  const utgSeat = bbSeat - 1 <= 0 ? maxSeat : bbSeat - 1;
  const utgPlayer = game.players.find(p => p.seatNumber === utgSeat);
  
  if (!utgPlayer) {
    throw new Error(`Could not find UTG player. BB seat: ${bbSeat}, UTG seat: ${utgSeat}`);
  }

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
      game.players.map(async (p, index) => {
        const updated = await prisma.player.findUnique({ where: { id: p.id } });
        // Parse hole cards from database (stored as JSON string)
        // If updated player has holeCards, use those (parsed if string)
        // Otherwise fall back to p.holeCards (parsed if string)
        // If neither exists, use dealtHands from current hand
        let holeCards = null;
        if (updated?.holeCards) {
          if (typeof updated.holeCards === 'object') {
            holeCards = updated.holeCards;
          } else if (typeof updated.holeCards === 'string') {
            try {
              holeCards = JSON.parse(updated.holeCards);
            } catch (e) {
              console.warn(`[POKER] Failed to parse holeCards from database for player ${p.id}:`, e.message);
              holeCards = dealtHands[index];
            }
          }
        } else if (p.holeCards) {
          if (typeof p.holeCards === 'object') {
            holeCards = p.holeCards;
          } else if (typeof p.holeCards === 'string') {
            try {
              holeCards = JSON.parse(p.holeCards);
            } catch (e) {
              console.warn(`[POKER] Failed to parse holeCards from p for player ${p.id}:`, e.message);
              holeCards = dealtHands[index];
            }
          }
        } else {
          holeCards = dealtHands[index];
        }
        return {
          ...p,
          chips: updated?.chips || p.chips,
          holeCards: holeCards, // Include parsed hole cards
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
 * Start a turn timer for a player
 * Human players: 10 seconds grace period, then 10 second countdown (20 seconds total)
 * Test players: 3 seconds total
 */
function startTurnTimer(gameId, userId, io) {
  // Clear existing timer for this game
  const existingTimer = turnTimers.get(gameId);
  if (existingTimer) {
    clearTimeout(existingTimer.timerId);
    if (existingTimer.graceTimerId) {
      clearTimeout(existingTimer.graceTimerId);
    }
    turnTimers.delete(gameId);
  }

  // Get game state to check if player is test player
  const state = tableState.get(gameId);
  if (!state) return;

  const player = state.players.find((p) => p.userId === userId);
  if (!player) return;

  const isTestPlayer = player.name?.toLowerCase().startsWith('test player');

  if (isTestPlayer) {
    // Test players: 3 seconds total, auto-act after
    const timeoutMs = 3000;
    const expiresAt = Date.now() + timeoutMs;
    
    const timerId = setTimeout(() => {
      autoActTestPlayer(gameId, userId, io);
    }, timeoutMs);

    turnTimers.set(gameId, { timerId, userId, expiresAt, duration: timeoutMs });

    // Emit timer start immediately for test players
    if (io) {
      io.to(`game:${gameId}`).emit("turn-timer-start", {
        gameId,
        userId,
        expiresAt,
        duration: timeoutMs
      });
    }
  } else {
    // Human players: 10 seconds grace, then 10 second countdown (20 seconds total)
    const gracePeriodMs = 10000;
    const countdownMs = 10000;
    const totalTimeoutMs = gracePeriodMs + countdownMs;
    const expiresAt = Date.now() + totalTimeoutMs;
    
    // After grace period, emit timer start event (shows countdown)
    const graceTimerId = setTimeout(() => {
      if (io) {
        io.to(`game:${gameId}`).emit("turn-timer-start", {
          gameId,
          userId,
          expiresAt,
          duration: countdownMs
        });
      }
    }, gracePeriodMs);

    // After total timeout, auto-fold
    const timeoutTimerId = setTimeout(() => {
      autoFoldPlayer(gameId, userId, io);
    }, totalTimeoutMs);

    // Store both timers
    turnTimers.set(gameId, { 
      timerId: timeoutTimerId, 
      graceTimerId,
      userId, 
      expiresAt, 
      duration: countdownMs,
      gracePeriodMs 
    });
  }
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
 * Move to the next player to act (clockwise - decreasing seat numbers for anticlockwise seat numbering)
 */
async function moveToNextPlayer(gameId, io) {
  const state = tableState.get(gameId);
  if (!state) return;

  const activePlayers = state.players.filter((p) => p.status !== 'FOLDED' && p.status !== 'ELIMINATED');
  
  if (activePlayers.length === 0) {
    state.currentTurnUserId = null;
    return;
  }

  if (!state.currentTurnUserId) {
    // No current player, start with UTG (first player after BB, which we'll calculate from dealer)
    // For now, just use the first active player with lowest seat number
    const sortedPlayers = [...activePlayers].sort((a, b) => a.seatNumber - b.seatNumber);
    state.currentTurnUserId = sortedPlayers[0].userId;
    startTurnTimer(gameId, state.currentTurnUserId, io);
    return;
  }

  // Get max seat number from all players (not just active)
  const allSeats = Math.max(...state.players.map(p => p.seatNumber));
  const currentPlayer = activePlayers.find((p) => p.userId === state.currentTurnUserId);
  
  if (!currentPlayer) {
    // Current player not found, start with first active
    const sortedPlayers = [...activePlayers].sort((a, b) => a.seatNumber - b.seatNumber);
    state.currentTurnUserId = sortedPlayers[0].userId;
    startTurnTimer(gameId, state.currentTurnUserId, io);
    return;
  }

  const currentSeat = currentPlayer.seatNumber;
  
  // Create a map of seat number to player for faster lookup
  const seatMap = new Map();
  activePlayers.forEach(p => {
    if (p.userId !== state.currentTurnUserId) {
      seatMap.set(p.seatNumber, p);
    }
  });
  
  // Find next player clockwise (decreasing seat number, wrapping)
  // Start from currentSeat - 1 and search backwards
  let nextSeat = currentSeat - 1;
  if (nextSeat <= 0) nextSeat = allSeats;
  
  let attempts = 0;
  let nextPlayer = null;
  
  // Search through all possible seats (at most allSeats attempts)
  while (attempts < allSeats && !nextPlayer) {
    // Look for an active player at this seat
    nextPlayer = seatMap.get(nextSeat);
    
    if (!nextPlayer) {
      // Move to next seat clockwise (decrease seat number)
      nextSeat = nextSeat - 1;
      if (nextSeat <= 0) nextSeat = allSeats;
      attempts++;
    }
  }
  
  if (nextPlayer) {
    console.log(`[POKER] Turn rotation: seat ${currentSeat} → seat ${nextPlayer.seatNumber} (clockwise)`);
    state.currentTurnUserId = nextPlayer.userId;
    startTurnTimer(gameId, state.currentTurnUserId, io);
  } else {
    // Only one player left or no valid next player
    console.log(`[POKER] Turn rotation: No next player found from seat ${currentSeat}`);
    state.currentTurnUserId = null;
  }
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
        // 3. Tournament is RUNNING (not just SEATED)
        // 4. There are at least 2 players
        let state = tableState.get(gameId);
        if (!state && game.status === "ACTIVE" && game.players.length >= 2) {
          // Only start hand if tournament is RUNNING
          if (game.tournament && game.tournament.status === "RUNNING") {
            try {
              // Use the exported startHandForGame function to ensure consistency
              state = await startHandForGame(gameId, socket.server);
            } catch (handError) {
              console.error("[POKER] Error auto-starting hand:", handError);
              // Continue without state if hand creation fails
            }
          }
        }

        // Get state again in case it was just created
        state = tableState.get(gameId);
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
        // Clear turn timer for this game before processing action
        const existingTimer = turnTimers.get(gameId);
        if (existingTimer) {
          clearTimeout(existingTimer.timerId);
          if (existingTimer.graceTimerId) {
            clearTimeout(existingTimer.graceTimerId);
          }
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


